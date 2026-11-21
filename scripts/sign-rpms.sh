#!/usr/bin/env bash
# Signs every .rpm in a directory with the repository key, so dnf checks each package as well as
# the repository metadata (gpgcheck=1 in packaging/repo/ukemi.repo), then checks the signatures
# against packaging/repo/ukemi.asc. scripts/sign-release.sh runs it on the draft's files before it
# writes SHA256SUMS, because signing changes the files.
#
#   scripts/sign-rpms.sh <directory>
#
# Needs rpmsign (rpm-sign, rpm 4.20 or later), rpmkeys and gpg with the repository key. Signs with
# the key $UKEMI_REPO_KEY names, or else the one in packaging/repo/ukemi.asc.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
public_key="$root/packaging/repo/ukemi.asc"

die() {
    printf 'sign-rpms: %s\n' "$*" >&2
    exit 1
}

[[ $# -eq 1 && -d "$1" ]] || die "usage: sign-rpms.sh <directory>"
for tool in rpmsign rpmkeys gpg; do
    command -v "$tool" >/dev/null || die "needs $tool (dnf install rpm-sign)"
done
shopt -s nullglob
rpms=("$1"/*.rpm)
[[ ${#rpms[@]} -gt 0 ]] || die "no .rpm in $1"

fingerprint="$(gpg --show-keys --with-colons "$public_key" | awk -F: '$1 == "fpr" { print $10; exit }')"
[[ -n "$fingerprint" ]] || die "cannot read packaging/repo/ukemi.asc"
rpmdb="$(mktemp -d)"
trap 'rm -rf -- "$rpmdb"' EXIT
rpmkeys --dbpath "$rpmdb" --import "$public_key"

for rpm in "${rpms[@]}"; do
    rpmsign --addsign --key-id "${UKEMI_REPO_KEY:-$fingerprint}" "$rpm" >/dev/null
    # An unsigned package passes --checksig on its digests alone, so look for the signature. The
    # key database holds only the repository key, so another key's signature is not OK.
    checked="$(rpmkeys --dbpath "$rpmdb" --checksig --verbose "$rpm" || true)"
    grep -qiE 'signature.*: OK$' <<<"$checked" ||
        die "$(basename "$rpm") is not signed by packaging/repo/ukemi.asc"
    echo "signed $(basename "$rpm")"
done
