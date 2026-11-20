#!/bin/sh
# Signs a draft release with the release key, which stays on this machine, and publishes it:
#
#   scripts/sign-release.sh v0.17.0
#
# CI builds the files and attaches them to the draft. This script downloads them, checks that the
# tag is on main, that install.sh is the tagged one and that no required file is missing. It then
# writes SHA256SUMS over every file, signs it as SHA256SUMS.minisig (trusted comment
# "ukemi <version>"), uploads both and publishes the release. Ukemi's updater accepts only releases
# signed this way. Publishing starts the jobs that update the extension stores and the website.
# Then scripts/publish-repo.sh signs the apt and dnf repositories CI builds for the release.
#
# Needs gh (logged in), git, sha256sum and minisign or rsign (rsign2), and for the repositories
# gpg with the repository key (see publish-repo.sh). The key is read from
# $UKEMI_SIGNING_KEY, or else ~/.minisign/ukemi.key. rsign asks for the key's password; set
# UKEMI_SIGNING_PASSWORDLESS=1 for a key without one.
set -eu

repo="samuelba/ukemi"
root="$(cd "$(dirname "$0")/.." && pwd)"
public_key="$root/resources/minisign.pub"
key="${UKEMI_SIGNING_KEY:-$HOME/.minisign/ukemi.key}"

die() {
    printf 'sign-release: %s\n' "$*" >&2
    exit 1
}
has() { command -v "$1" >/dev/null 2>&1; }

[ $# -eq 1 ] || die "usage: sign-release.sh <tag>, e.g. v0.17.0"
version="${1#v}"
tag="v$version"
[ -f "$key" ] || die "no secret key at $key"
has gh || die "needs gh"
has minisign || has rsign || die "needs minisign or rsign"

[ "$(gh release view "$tag" --repo "$repo" --json isDraft --jq .isDraft)" = true ] ||
    die "$tag is not a draft release"

git -C "$root" fetch --quiet origin main "refs/tags/$tag:refs/tags/$tag"
git -C "$root" merge-base --is-ancestor "$tag" FETCH_HEAD ||
    die "$tag is not on origin/main"

work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
trap 'exit 130' INT TERM

gh release download "$tag" --repo "$repo" --dir "$work"
rm -f -- "$work/SHA256SUMS" "$work/SHA256SUMS.minisig"

for name in install.sh "ukemi-jj-$version.vsix" "Ukemi-$version.AppImage" \
    "Ukemi-$version-arm64.AppImage" "Ukemi-$version-linux-x64.tar.gz" \
    "Ukemi-$version-linux-arm64.tar.gz" "Ukemi-$version-arm64.dmg" "Ukemi-$version-x64.dmg"; do
    [ -f "$work/$name" ] || die "$name is missing from the draft. Has the release workflow finished?"
done
set -- "$work"/*.exe
[ -f "$1" ] || die "the Windows installer is missing from the draft. Has the release workflow finished?"

git -C "$root" show "$tag:scripts/install.sh" | cmp -s - "$work/install.sh" ||
    die "the release's install.sh is not the one in $tag"

(cd "$work" && sha256sum -- * >SHA256SUMS)
cat "$work/SHA256SUMS"
printf 'Sign and publish %s with these files? [y/N] ' "$tag"
read -r answer
[ "$answer" = y ] || die "nothing was signed"

comment="ukemi $version"
if has minisign; then
    minisign -S -s "$key" -m "$work/SHA256SUMS" -t "$comment"
    minisign -V -p "$public_key" -m "$work/SHA256SUMS"
else
    rsign sign ${UKEMI_SIGNING_PASSWORDLESS:+-W} -s "$key" -t "$comment" -x "$work/SHA256SUMS.minisig" "$work/SHA256SUMS"
    rsign verify -p "$public_key" -x "$work/SHA256SUMS.minisig" "$work/SHA256SUMS"
fi

gh release upload "$tag" "$work/SHA256SUMS" "$work/SHA256SUMS.minisig" --clobber --repo "$repo"
gh release edit "$tag" --draft=false --latest --repo "$repo"
printf 'Published %s.\n' "$tag"

# Publishing started the Repository workflow; sign what it builds and deploy it.
"$root/scripts/publish-repo.sh" "$tag" ||
    die "the release is published, but the apt and dnf repositories are not; retry with: scripts/publish-repo.sh $tag"
