#!/usr/bin/env bash
# Signs the apt and dnf repositories that a Repository workflow run built, with the repository
# key, which stays on this machine, and has the Repository deploy workflow put them on GitHub
# Pages. scripts/sign-release.sh runs it after publishing a release. Run it by hand to retry, or
# after starting the Repository workflow by hand:
#
#   scripts/publish-repo.sh v0.19.0       # the run that publishing v0.19.0 started
#   scripts/publish-repo.sh 12345678901   # that run
#   scripts/publish-repo.sh site/         # a local build-repo.sh build: signs it, no deploy
#
# Nothing CI made is signed unchecked. The repositories hold only metadata; the packages stay on
# the GitHub releases, listed as pool/<tag>/<file>. The script fetches the metadata and the
# signed SHA256SUMS of every release in it, and refuses unless every package the metadata lists
# has the name and hash the release key signed for that tag, and carries only the fields Ukemi's
# packages have: its version and architecture from the signed file name, and the dependencies
# electron-builder.yml declares, so nothing can conflict with, replace or obsolete another
# package. apt and dnf check each package they download against the signed metadata, so they
# only ever install those.
#
# Needs gh (logged in), gpg and gpgv, sha256sum, and minisign or rsign. Signs with the key
# $UKEMI_REPO_KEY names, or else the one in packaging/repo/ukemi.asc.
set -euo pipefail

repo="samuelba/ukemi"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
public_key="$root/packaging/repo/ukemi.asc"

# The dependencies of electron-builder.yml's deb and rpm, one per line. A package may only have these.
deb_depends='libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0 libuuid1 libsecret-1-0'
deb_recommends='libappindicator3-1'
rpm_requires='/bin/sh|gtk3|libnotify|nss|libXScrnSaver|(libXtst or libXtst6)|xdg-utils|at-spi2-core|(libuuid or libuuid1)'

die() {
    printf 'publish-repo: %s\n' "$*" >&2
    exit 1
}

[[ $# -eq 1 ]] || die "usage: publish-repo.sh <tag or run id>, e.g. v0.19.0"
for tool in gh gpg gpgv sha256sum; do
    command -v "$tool" >/dev/null || die "needs $tool"
done
[[ -f "$public_key" ]] || die "no repository key at packaging/repo/ukemi.asc"

work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
trap 'exit 130' INT TERM
site="$work/site"
sha256() { sha256sum <"$1" | cut -d' ' -f1; }

# --- The run --------------------------------------------------------------------------------

tag=""
run=""
local_build=""
if [[ -d "$1" ]]; then
    local_build="$(realpath -- "$1")"
    mkdir -p "$site"
    (cd "$local_build" && find . \! -type d \! -name InRelease \! -name Release.gpg \
        \! -name repomd.xml.asc -printf '%P\0' | xargs -0 cp --parents -t "$site" --)
elif [[ "$1" =~ ^[0-9]+$ ]]; then
    run="$1"
else
    tag="v${1#v}"
    # Publishing the release starts the run; it can take a moment to show up.
    for _ in $(seq 30); do
        run="$(gh run list --repo "$repo" --workflow repo.yml --event release --branch "$tag" \
            --limit 1 --json databaseId --jq '.[0].databaseId // empty')"
        [[ -n "$run" ]] && break
        sleep 2
    done
    [[ -n "$run" ]] || die "no Repository run for $tag; start one with: gh workflow run repo.yml"
fi
if [[ -n "$run" ]]; then
    [[ "$(gh run view "$run" --repo "$repo" --json workflowName --jq .workflowName)" == Repository ]] ||
        die "run $run is not a Repository run"
    echo "== waiting for run $run"
    gh run watch "$run" --repo "$repo" --exit-status >/dev/null || die "run $run failed"
    gh run download "$run" --repo "$repo" --name repo --dir "$site"
fi

# --- The releases in it, and what their signed checksums allow ------------------------------

# "<sha256> <tag>/<name>" for every package the release key signed.
allowed="$work/allowed"
: >"$allowed"
mapfile -t releases <"$site/releases.txt"
[[ ${#releases[@]} -gt 0 ]] || die "the repository holds no release"
for release in "${releases[@]}"; do
    [[ "$release" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "\"$release\" is not a release tag"
    dir="$work/sums/$release"
    gh release download "$release" --repo "$repo" --dir "$dir" \
        --pattern SHA256SUMS --pattern SHA256SUMS.minisig
    "$root/scripts/verify-sums.sh" "$dir" "$release"
    sed -nE "s#^([0-9a-f]{64}) [ *](ukemi[-_][^/ ]+\.(deb|rpm))\$#\1 $release/\2#p" \
        "$dir/SHA256SUMS" >>"$allowed"
done
if [[ -n "$tag" ]] && ! printf '%s\n' "${releases[@]}" | grep -qxF -- "$tag"; then
    die "the repository does not hold $tag"
fi

# Fails unless every "<sha256> <tag>/<name>" line on stdin is a signed package.
only_signed() {
    local what="$1" hash name count=0
    while read -r hash name; do
        [[ "$hash" != - ]] || die "$what has $name"
        grep -qxF -- "$hash $name" "$allowed" ||
            die "$what lists $name ($hash), which no release signed"
        count=$((count + 1))
    done
    [[ $count -gt 0 ]] || die "$what lists no package"
}

# --- Every file is one that is expected -----------------------------------------------------

for pair in ukemi.asc:ukemi.asc index.html:index.html \
    deb/ukemi.sources:ukemi.sources rpm/ukemi.repo:ukemi.repo; do
    cmp -s -- "$site/${pair%%:*}" "$root/packaging/repo/${pair#*:}" ||
        die "${pair%%:*} is not packaging/repo/${pair#*:}"
done
expected='^(releases\.txt|index\.html|ukemi\.asc|deb/ukemi\.sources|rpm/ukemi\.repo'
expected+='|deb/dists/stable/Release|deb/dists/stable/main/binary-(amd64|arm64)/Packages(\.gz)?'
expected+='|rpm/repodata/repomd\.xml|rpm/repodata/[0-9a-f]{64}-(primary|filelists|other)\.xml\.gz)$'
while read -r file; do
    [[ "$file" =~ $expected ]] || die "unexpected file $file"
done < <(cd "$site" && find . \! -type d -printf '%P\n')

# --- apt ------------------------------------------------------------------------------------

echo "== checking the apt repository"
dists="$site/deb/dists/stable"
# Release: plain fields, then the SHA256 of each index. apt trusts the strongest hash listed, so
# no other hash may be there.
while IFS= read -r line; do
    case "$line" in
        "SHA256:") ;;
        " "*)
            read -r hash _ path <<<"$line"
            [[ "$path" =~ ^main/binary-(amd64|arm64)/Packages(\.gz)?$ ]] ||
                die "Release lists an unexpected file $path"
            [[ "$(sha256 "$dists/$path")" == "$hash" ]] || die "Release has the wrong hash for $path"
            ;;
        Origin:* | Label:* | Suite:* | Codename:* | Date:* | Architectures:* | Components:* | Description:*) ;;
        *) die "Release has an unexpected line: $line" ;;
    esac
done <"$dists/Release"
for arch in amd64 arm64; do
    packages="$dists/main/binary-$arch/Packages"
    zcat -- "$packages.gz" | cmp -s - "$packages" || die "Packages.gz for $arch is not Packages"
    [[ -s "$packages" ]] || continue
    # One "<sha256> <tag>/<name>" per stanza that has only the fields fpm and apt-ftparchive
    # write, for ukemi at the version and architecture its signed file name says.
    awk -v RS= -F '\n' -v want="$arch" -v depends="$deb_depends" -v recommends="$deb_recommends" '
        function only(value, allowed,    count, i, items) {
            count = split(value, items, ", ")
            for (i = 1; i <= count; i++)
                if (index(" " allowed " ", " " items[i] " ") == 0) return 0
            return 1
        }
        {
            ok = 1; field = ""; package = ""; version = ""; arch = ""; file = ""; hash = ""
            delete seen
            for (i = 1; i <= NF; i++) {
                line = $i
                if (line ~ /^ /) { if (field != "Description") ok = 0; continue }
                colon = index(line, ": ")
                if (colon == 0) { ok = 0; continue }
                field = substr(line, 1, colon - 1); value = substr(line, colon + 2)
                if (seen[field]++) ok = 0
                if (field == "Package") package = value
                else if (field == "Version") version = value
                else if (field == "Architecture") arch = value
                else if (field == "Filename") file = value
                else if (field == "SHA256") hash = value
                else if (field == "Depends") { if (!only(value, depends)) ok = 0 }
                else if (field == "Recommends") { if (!only(value, recommends)) ok = 0 }
                else if (field !~ /^(Priority|Section|Maintainer|Installed-Size|Size|Homepage|Description|License|Vendor)$/) ok = 0
            }
            if (package != "ukemi" || arch != want || hash == "") ok = 0
            if (file != "pool/v" version "/ukemi_" version "_" arch ".deb") ok = 0
            if (ok) print hash, substr(file, 6)
            else print "-", "an unexpected stanza (number " NR ")"
        }' "$packages" | only_signed "the $arch Packages"
done

# --- dnf ------------------------------------------------------------------------------------

echo "== checking the dnf repository"
repodata="$site/rpm/repodata"
! grep -q 'xml:base' "$repodata/repomd.xml" || die "repomd.xml points elsewhere (xml:base)"
# "<type> <sha256> <file>" for each metadata file repomd.xml lists.
awk '
    /<data type="/ {
        match($0, /type="[^"]*"/); type = substr($0, RSTART + 6, RLENGTH - 7); hash = "-"; href = "-"
    }
    /<checksum type="sha256">/ { if (match($0, />[0-9a-f]+</)) hash = substr($0, RSTART + 1, RLENGTH - 2) }
    /<location href="/ { match($0, /href="[^"]*"/); href = substr($0, RSTART + 6, RLENGTH - 7) }
    /<\/data>/ { print type, hash, href }
' "$repodata/repomd.xml" >"$work/repomd"
[[ "$(grep -c '<data ' "$repodata/repomd.xml")" == "$(wc -l <"$work/repomd")" ]] ||
    die "repomd.xml is not in the expected form"
primary=""
while read -r type hash href; do
    [[ "$type" =~ ^(primary|filelists|other)$ ]] || die "repomd.xml lists unexpected $type data"
    [[ "$href" =~ ^repodata/[0-9a-f]{64}-$type\.xml\.gz$ ]] || die "repomd.xml lists $href"
    [[ "$(sha256 "$site/rpm/$href")" == "$hash" ]] || die "repomd.xml has the wrong hash for $href"
    [[ "$type" == primary ]] && primary="$site/rpm/$href"
done <"$work/repomd"
[[ -n "$primary" ]] || die "repomd.xml lists no primary data"
zcat -- "$primary" >"$work/primary.xml"
! grep -q 'xml:base' "$work/primary.xml" || die "the primary data points elsewhere (xml:base)"
# One "<sha256> <tag>/<name>" per package: dnf downloads pool/<tag>/<name> and checks <sha256>.
# Each package may hold only the elements createrepo_c writes for ukemi: its own name and
# version from the signed file name, provides of ukemi alone, requires from electron-builder.yml
# alone, and no conflicts, obsoletes or weak dependencies.
awk -v requires="$rpm_requires" '
    function attr(line, key) {
        if (match(line, " " key "=\"[^\"]*\"")) return substr(line, RSTART + length(key) + 3, RLENGTH - length(key) - 4)
        return ""
    }
    function text(line) {
        if (match(line, />[^<]*</)) return substr(line, RSTART + 1, RLENGTH - 2)
        return ""
    }
    /<package type="rpm">/ {
        inside = 1; ok = 1; section = ""; name = ""; arch = ""; epoch = ""; ver = ""
        hash = "-"; file = "an unreadable package"; next
    }
    inside && /<\/package>/ {
        if (name != "ukemi" || epoch != "0" || file != "pool/v" ver "/ukemi-" ver "." arch ".rpm") ok = 0
        if (ok) print hash, substr(file, 6)
        else print "-", "an unexpected entry for " file
        inside = 0; next
    }
    !inside { next }
    # Lines without a tag continue a description.
    !match($0, /<\/?[a-z:-]+/) { next }
    {
        tag = substr($0, RSTART + 1, RLENGTH - 1); closing = sub(/^\//, "", tag)
        if (tag == "name") name = text($0)
        else if (tag == "arch") arch = text($0)
        else if (tag == "version") { epoch = attr($0, "epoch"); ver = attr($0, "ver") }
        else if (tag == "checksum") {
            if ($0 ~ /pkgid="YES"/ && match($0, />[0-9a-f]+</)) hash = substr($0, RSTART + 1, RLENGTH - 2)
            else ok = 0
        }
        else if (tag == "location") {
            if (match($0, /<location href="pool\/v[0-9.]+\/[^"\/]+\.rpm"\/>/)) file = substr($0, RSTART + 16, RLENGTH - 19)
            else ok = 0
        }
        else if (tag == "rpm:provides" || tag == "rpm:requires") section = closing ? "" : tag
        else if (tag == "rpm:entry") {
            entry = attr($0, "name")
            if (section == "rpm:provides") { if (entry != "ukemi" && entry !~ /^ukemi\([a-z0-9_-]+\)$/) ok = 0 }
            else if (section == "rpm:requires") { if (index("|" requires "|", "|" entry "|") == 0) ok = 0 }
            else ok = 0
        }
        else if (tag == "file") { if (tolower($0) !~ /ukemi/) ok = 0 }
        else if (tag !~ /^(summary|description|packager|url|time|size|format|rpm:license|rpm:vendor|rpm:group|rpm:buildhost|rpm:sourcerpm|rpm:header-range)$/) ok = 0
    }
' "$work/primary.xml" >"$work/primary"
[[ "$(grep -c '<package ' "$work/primary.xml")" == "$(wc -l <"$work/primary")" ]] ||
    die "the primary data is not in the expected form"
only_signed "the primary data" <"$work/primary"

# --- Signing --------------------------------------------------------------------------------

fingerprint="$(gpg --show-keys --with-colons "$public_key" | awk -F: '$1 == "fpr" { print $10; exit }')"
key="${UKEMI_REPO_KEY:-$fingerprint}"
gpg --dearmor <"$public_key" >"$work/keyring.gpg"

echo
echo "Releases: ${releases[*]}"
echo "Packages:"
cat "$dists"/main/binary-*/Packages | sed -n 's|^Filename: pool/|  |p'
cut -d' ' -f2 "$work/primary" | sed 's/^/  /'
printf 'Sign the repository with %s and deploy it? [y/N] ' "$key"
read -r answer
[[ "$answer" == y ]] || die "nothing was signed"

sign() { gpg --yes --quiet --local-user "$key" --digest-algo SHA512 "$@"; }
sign --clearsign --output "$dists/InRelease" "$dists/Release"
sign --armor --detach-sign --output "$dists/Release.gpg" "$dists/Release"
sign --armor --detach-sign --output "$repodata/repomd.xml.asc" "$repodata/repomd.xml"
# The signatures must be by the key the packages ship, not just any key gpg has.
check() { gpgv --quiet --keyring "$work/keyring.gpg" "$@" 2>/dev/null; }
check "$dists/InRelease" || die "InRelease is not signed by packaging/repo/ukemi.asc"
check "$dists/Release.gpg" "$dists/Release" ||
    die "Release.gpg is not signed by packaging/repo/ukemi.asc"
check "$repodata/repomd.xml.asc" "$repodata/repomd.xml" ||
    die "repomd.xml.asc is not signed by packaging/repo/ukemi.asc"

# --- Deploying ------------------------------------------------------------------------------

if [[ -n "$local_build" ]]; then
    cp -- "$dists/InRelease" "$dists/Release.gpg" "$local_build/deb/dists/stable/"
    cp -- "$repodata/repomd.xml.asc" "$local_build/rpm/repodata/"
    echo "Signed $local_build; a local build is not deployed."
    exit 0
fi

# Run ids only grow: the deploy is the first run after the newest one so far.
newest="$(gh run list --repo "$repo" --workflow repo-deploy.yml --limit 1 --json databaseId \
    --jq '.[0].databaseId // 0')"
gh workflow run repo-deploy.yml --repo "$repo" --ref main \
    -f run="$run" \
    -f in_release="$(cat "$dists/InRelease")" \
    -f release_signature="$(cat "$dists/Release.gpg")" \
    -f repomd_signature="$(cat "$repodata/repomd.xml.asc")"
deploy=""
for _ in $(seq 30); do
    deploy="$(gh run list --repo "$repo" --workflow repo-deploy.yml --event workflow_dispatch \
        --limit 5 --json databaseId --jq "[.[] | select(.databaseId > $newest)] | last | .databaseId // empty")"
    [[ -n "$deploy" ]] && break
    sleep 2
done
if [[ -z "$deploy" ]]; then
    echo "Started the deploy; follow it with: gh run list --repo $repo --workflow repo-deploy.yml"
    exit 0
fi
echo "== waiting for the deploy, run $deploy"
gh run watch "$deploy" --repo "$repo" --exit-status >/dev/null || die "the deploy (run $deploy) failed"
echo "Deployed the repository to https://samuelba.github.io/ukemi/ (served at https://samuelba.dev/ukemi/deb and /rpm)."
