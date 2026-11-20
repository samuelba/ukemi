#!/usr/bin/env bash
# Builds the apt and dnf repository metadata that GitHub Pages serves, from the packages of the last
# published releases, into site/ (or the directory given):
#
#   deb/dists/stable/...   apt metadata     rpm/repodata/...   dnf metadata
#
# The packages are not on Pages: at ~90 MB each they would outgrow its 1 GB and its bandwidth.
# Both repositories list them as pool/<tag>/<file>, and samuelba.dev redirects
# /ukemi/{deb,rpm}/pool/* to the release downloads and the rest of /ukemi/{deb,rpm}/ to Pages.
#
# Nothing is signed here. The Repository workflow runs this script when a release is published;
# scripts/publish-repo.sh then checks the metadata and signs it on the maintainer's machine, and
# the Repository deploy workflow puts it on GitHub Pages.
#
# Only releases whose SHA256SUMS are signed by the release key, whose packages add the repository
# and whose rpm packages are signed by the repository key go in, the newest $KEEP (default 3) of
# them. Needs gh, sha256sum, minisign or rsign, apt-ftparchive (apt-utils), createrepo_c, dpkg-deb
# and rpm.
set -euo pipefail

repo="samuelba/ukemi"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$(realpath -m -- "${1:-$root/site}")"
keep="${KEEP:-3}"
key="$root/packaging/repo/ukemi.asc"

die() {
    printf 'build-repo: %s\n' "$*" >&2
    exit 1
}

[[ -f "$key" ]] || die "no repository key at packaging/repo/ukemi.asc"
for tool in gh sha256sum apt-ftparchive createrepo_c dpkg-deb rpm rpmkeys; do
    command -v "$tool" >/dev/null || die "needs $tool"
done

# Replaces only an earlier build or an empty directory, never a mistyped path.
if [[ -e "$out" && ! -f "$out/releases.txt" && -n "$(ls -A -- "$out")" ]]; then
    die "$out is neither empty nor an earlier build"
fi
rm -rf -- "$out"
mkdir -p "$out/deb" "$out/rpm"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
mkdir -p "$work/deb/pool" "$work/rpm/pool" "$work/rpmdb"
# Holds only the repository key, so a signature by any other key does not check out.
rpmkeys --dbpath "$work/rpmdb" --import "$key"

# Whether every rpm in a directory carries the repository key's signature. --checksig passes an
# unsigned package on its digests alone, so look for the signature itself.
rpms_signed() {
    local rpm checked
    for rpm in "$1"/*.rpm; do
        checked="$(rpmkeys --dbpath "$work/rpmdb" --checksig --verbose "$rpm" || true)"
        grep -qiE 'signature.*: OK$' <<<"$checked" || return 1
    done
}

echo "== packages"
releases=()
while read -r tag <&3; do
    [[ ${#releases[@]} -lt $keep ]] || break
    dir="$work/releases/$tag"
    gh release download "$tag" --repo "$repo" --dir "$dir" \
        --pattern SHA256SUMS --pattern SHA256SUMS.minisig 2>/dev/null || true
    if [[ ! -f "$dir/SHA256SUMS.minisig" ]]; then
        echo "$tag: no signed checksums, left out"
        continue
    fi
    "$root/scripts/verify-sums.sh" "$dir" "$tag"
    # sha256sum lines: the hash, a space, a space or "*", and the name.
    grep -E '^[0-9a-f]{64} [ *]ukemi[-_][^/ ]+\.(deb|rpm)$' "$dir/SHA256SUMS" >"$dir/packages" ||
        die "$tag has no .deb or .rpm"
    gh release download "$tag" --repo "$repo" --dir "$dir" --pattern 'ukemi*.deb' --pattern 'ukemi*.rpm'
    (cd "$dir" && sha256sum --check --quiet --strict packages) ||
        die "the packages of $tag do not match their signed checksums"
    # Releases before the repository existed would remove it again on a downgrade. The list is
    # newest first, so no older release adds it either: stop before downloading their packages.
    if ! "$root/scripts/check-linux-packages.sh" "$dir" >/dev/null 2>&1; then
        echo "$tag: its packages do not add the repository; it and older releases are left out"
        break
    fi
    # dnf checks each package's signature (gpgcheck=1); scripts/sign-rpms.sh signs them.
    if ! rpms_signed "$dir"; then
        echo "$tag: its rpm packages are not signed; it and older releases are left out"
        break
    fi
    mkdir -p "$work/deb/pool/$tag" "$work/rpm/pool/$tag"
    while read -r _ name; do
        name="${name#\*}"
        case "$name" in
            *.deb) mv -- "$dir/$name" "$work/deb/pool/$tag/" ;;
            *.rpm) mv -- "$dir/$name" "$work/rpm/pool/$tag/" ;;
        esac
    done <"$dir/packages"
    echo "$tag: $(wc -l <"$dir/packages") packages"
    releases+=("$tag")
done 3< <(gh release list --repo "$repo" --exclude-drafts --exclude-pre-releases --limit 100 \
    --json tagName --jq '.[].tagName')
[[ ${#releases[@]} -gt 0 ]] || die "no published release has signed checksums and adds the repository"
# publish-repo.sh checks the metadata against these releases' signed checksums.
printf '%s\n' "${releases[@]}" >"$out/releases.txt"

echo "== apt repository"
(
    cd "$work/deb"
    # SHA256 only, in Release and in Packages: apt trusts the strongest hash listed, and
    # publish-repo.sh checks just this one against the release's signed checksums.
    sha256_only=(-o APT::FTPArchive::MD5=false -o APT::FTPArchive::SHA1=false
        -o APT::FTPArchive::SHA512=false)
    for arch in amd64 arm64; do
        dir="dists/stable/main/binary-$arch"
        mkdir -p "$dir"
        apt-ftparchive "${sha256_only[@]}" --arch "$arch" packages pool >"$dir/Packages"
        gzip -9 --no-name --keep "$dir/Packages"
    done
    apt-ftparchive "${sha256_only[@]}" \
        -o APT::FTPArchive::Release::Origin=Ukemi \
        -o APT::FTPArchive::Release::Label=Ukemi \
        -o APT::FTPArchive::Release::Suite=stable \
        -o APT::FTPArchive::Release::Codename=stable \
        -o APT::FTPArchive::Release::Architectures="amd64 arm64" \
        -o APT::FTPArchive::Release::Components=main \
        -o APT::FTPArchive::Release::Description="Ukemi, a Jujutsu (jj) GUI" \
        release dists/stable >"$work/Release"
    mv -- "$work/Release" dists/stable/Release
    cp -r -- dists "$out/deb/"
)

echo "== dnf repository"
# gzip, so publish-repo.sh reads the metadata with zcat. The locations stay relative to the
# package directory: pool/<tag>/<file>.
createrepo_c --quiet --no-database --general-compress-type=gz --outputdir "$out/rpm" "$work/rpm"

cp -- "$key" "$out/ukemi.asc"
cp -- "$root/packaging/repo/index.html" "$out/"
cp -- "$root/packaging/repo/ukemi.sources" "$out/deb/"
cp -- "$root/packaging/repo/ukemi.repo" "$out/rpm/"
find "$out" -type f | sort
