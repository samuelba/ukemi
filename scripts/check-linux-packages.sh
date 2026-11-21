#!/usr/bin/env bash
# Checks that the .deb and .rpm files in a directory (default out/desktop-release) install Ukemi's
# apt or dnf repository the way upgrades and the package managers need it:
#
#   - the repository file and key are conffiles (deb) or %config(noreplace) (rpm), so an upgrade
#     keeps a user's `Enabled: no` or `enabled=0`
#   - both are mode 0644: apt reads the key as the unprivileged _apt user
#   - the rpm provides only ukemi, so no library bundled with Electron stands in for a system one
#   - both hold chrome-sandbox, which the post-install script makes setuid where the kernel
#     lets no unprivileged program create a user namespace. electron-builder's snap target
#     deletes it from the app folder all Linux targets share.
#
# Needs dpkg-deb and rpm.
set -euo pipefail

dir="${1:-out/desktop-release}"

die() {
    printf 'check-linux-packages: %s\n' "$*" >&2
    exit 1
}

shopt -s nullglob
debs=("$dir"/*.deb)
rpms=("$dir"/*.rpm)
[[ ${#debs[@]} -gt 0 || ${#rpms[@]} -gt 0 ]] || die "no .deb or .rpm in $dir"

for deb in "${debs[@]}"; do
    conffiles="$(dpkg-deb --info "$deb" conffiles 2>/dev/null || true)"
    for path in /etc/apt/sources.list.d/ukemi.sources /etc/apt/keyrings/ukemi.asc; do
        grep -qxF -- "$path" <<<"$conffiles" || die "$deb: $path is not a conffile"
        mode="$(dpkg-deb --fsys-tarfile "$deb" | tar -tvf - ".$path" | cut -c1-10)"
        [[ "$mode" == -rw-r--r-- ]] || die "$deb: $path has mode $mode, not -rw-r--r--"
    done
    contents="$(dpkg-deb --fsys-tarfile "$deb" | tar -tf -)"
    grep -qxF ./opt/Ukemi/chrome-sandbox <<<"$contents" || die "$deb has no /opt/Ukemi/chrome-sandbox"
    echo "$deb: ok"
done

for rpm in "${rpms[@]}"; do
    files="$(rpm -qp --qf '[%{FILEMODES:perms} %{FILEFLAGS:fflags} %{FILENAMES}\n]' "$rpm")"
    for path in /etc/yum.repos.d/ukemi.repo /etc/pki/rpm-gpg/RPM-GPG-KEY-ukemi; do
        line="$(grep -F -- " $path" <<<"$files" || true)"
        [[ "$line" == "-rw-r--r-- cn $path" ]] ||
            die "$rpm: $path is \"$line\", not a 0644 %config(noreplace) file"
    done
    grep -qE ' /opt/Ukemi/chrome-sandbox$' <<<"$files" || die "$rpm has no /opt/Ukemi/chrome-sandbox"
    unexpected="$(rpm -qp --provides "$rpm" | sed 's/ = .*//' | grep -vxE 'ukemi|ukemi\([a-z0-9_-]+\)' || true)"
    [[ -z "$unexpected" ]] || die "$rpm provides more than ukemi: $unexpected"
    echo "$rpm: ok"
done
