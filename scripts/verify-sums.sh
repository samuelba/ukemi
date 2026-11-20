#!/bin/sh
# Checks a release's SHA256SUMS against SHA256SUMS.minisig in the same directory, like Ukemi's
# updater does: the signature must be by resources/minisign.pub, and its trusted comment must name
# the version, so an older release's signed checksums cannot stand in for a newer one's.
#
#   scripts/verify-sums.sh <directory> <version>
#
# Needs minisign or rsign (rsign2). Prints nothing and exits 0 when the checksums are good.
set -eu

die() {
    printf 'verify-sums: %s\n' "$*" >&2
    exit 1
}

[ $# -eq 2 ] || die "usage: verify-sums.sh <directory> <version>"
dir="$1"
version="${2#v}"
root="$(cd "$(dirname "$0")/.." && pwd)"
public_key="$root/resources/minisign.pub"
sums="$dir/SHA256SUMS"
signature="$dir/SHA256SUMS.minisig"
[ -f "$sums" ] && [ -f "$signature" ] || die "$dir has no SHA256SUMS and SHA256SUMS.minisig"

if command -v minisign >/dev/null 2>&1; then
    minisign -V -q -p "$public_key" -m "$sums" -x "$signature" >/dev/null ||
        die "the checksums of $version are not signed by the release key"
elif command -v rsign >/dev/null 2>&1; then
    rsign verify -q -p "$public_key" -x "$signature" "$sums" >/dev/null ||
        die "the checksums of $version are not signed by the release key"
else
    die "needs minisign or rsign"
fi

# The signature just checked covers the trusted comment too.
comment="$(sed -n 's/^trusted comment: //p' "$signature")"
[ "$comment" = "ukemi $version" ] ||
    die "the checksums are signed for \"$comment\", not \"ukemi $version\""
