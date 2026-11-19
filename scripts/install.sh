#!/bin/sh
# Installs or updates the Ukemi desktop app for the current user, without sudo. Only on Ubuntu
# 23.10 and later it asks, once, to install an AppArmor profile that Electron's sandbox needs:
#
#   curl -fsSL https://samuelba.dev/ukemi/install.sh | sh
#
# Running it again updates to the latest release. Options (after `sh -s --` when piped):
#   --force      reinstall even when this version is already installed
#   --uninstall  remove Ukemi; settings and sign-ins stay
# Environment: UKEMI_VERSION pins a release (e.g. 0.17.0). UKEMI_FORCE=1 and UKEMI_UNINSTALL=1 do
# the same as the options. UKEMI_SHA256SUMS is the release's SHA256SUMS, which Ukemi's updater
# passes after checking its signature.
#
# Linux: the unpacked app in ~/.local/share/ukemi/versions/<version>, with ~/.local/share/ukemi/current
# linking to the installed one, the `ukemi` command in ~/.local/bin, and the app menu entry and
# icon under ~/.local/share. An install made by earlier versions of this script, as an AppImage,
# is moved to this layout.
# macOS: Ukemi.app in /Applications, or ~/Applications when that is not writable, and the `ukemi`
# command in ~/.local/bin.
set -eu

repo="https://github.com/samuelba/ukemi"
bin_dir="${XDG_BIN_HOME:-$HOME/.local/bin}"
data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
command_path="$bin_dir/ukemi"
marker="$data_dir/ukemi/install-method"

force="${UKEMI_FORCE:-0}"
uninstall="${UKEMI_UNINSTALL:-0}"
for arg in "$@"; do
    case "$arg" in
        --force) force=1 ;;
        --uninstall) uninstall=1 ;;
        -h | --help)
            echo "Usage: install.sh [--force] [--uninstall]"
            echo "Set UKEMI_VERSION to install a specific release."
            exit 0
            ;;
        *)
            echo "ukemi install: unknown option $arg" >&2
            exit 2
            ;;
    esac
done

say() { printf '%s\n' "$*"; }
die() {
    printf 'ukemi install: %s\n' "$*" >&2
    exit 1
}
has() { command -v "$1" >/dev/null 2>&1; }

fetch() { # URL FILE
    if has curl; then
        curl -fsSL --proto '=https' --tlsv1.2 -o "$2" "$1"
    elif has wget; then
        wget -q --https-only -O "$2" "$1"
    else
        die "needs curl or wget"
    fi
}

latest_version() {
    if has curl; then
        url="$(curl -fsSLI --proto '=https' -o /dev/null -w '%{url_effective}' "$repo/releases/latest")"
    elif has wget; then
        url="$(wget -q --https-only -S --spider --max-redirect=0 "$repo/releases/latest" 2>&1 |
            sed -n 's/^ *[Ll]ocation: *//p' | tr -d '\r' | tail -n 1)" || true
    else
        die "needs curl or wget"
    fi
    version="${url##*/tag/v}"
    case "$version" in
        "" | */*) die "cannot find the latest release at $repo/releases/latest" ;;
    esac
    printf '%s\n' "$version"
}

sha256() {
    if has sha256sum; then
        sha256sum "$1" | awk '{ print $1 }'
    elif has shasum; then
        shasum -a 256 "$1" | awk '{ print $1 }'
    else
        die "needs sha256sum or shasum to check the download"
    fi
}

# Downloads a release file to $tmp and checks it against the release's SHA256SUMS. HINT follows
# the error when the release has no such file.
download() { # NAME [HINT]
    say "Downloading $1"
    if [ -n "${UKEMI_SHA256SUMS:-}" ]; then
        printf '%s\n' "$UKEMI_SHA256SUMS" >"$tmp/SHA256SUMS"
    else
        fetch "$repo/releases/download/v$version/SHA256SUMS" "$tmp/SHA256SUMS" ||
            die "cannot download the checksums of v$version. Check your connection and that this version exists. Releases before 0.17.0 have no checksums and cannot be installed this way. Nothing was installed."
    fi
    expected="$(awk -v name="$1" '$2 == name || $2 == "*" name { print $1 }' "$tmp/SHA256SUMS")"
    [ -n "$expected" ] || die "$1 is missing from the release v$version.${2:-} Nothing was installed."
    fetch "$repo/releases/download/v$version/$1" "$tmp/$1" ||
        die "cannot download $1. Nothing was installed."
    [ "$(sha256 "$tmp/$1")" = "$expected" ] ||
        die "the download does not match its checksum. Nothing was installed."
}

write_marker() {
    mkdir -p "${marker%/*}"
    printf 'method=script\nversion=%s\n' "$version" >"$marker"
}

marker_version() {
    [ -f "$marker" ] && sed -n 's/^version=//p' "$marker"
}

# Tells where to find the `ukemi` command, and the outcome of an install or update.
finish() { # PREVIOUS RESTART_HINT
    say ""
    if [ -z "$1" ]; then
        say "Installed Ukemi $version. Start it from the app menu, or run: ukemi"
        case ":$PATH:" in
            *":$bin_dir:"*) ;;
            *) say "Add $bin_dir to your PATH to run \`ukemi\` from a shell." ;;
        esac
    elif [ "$1" = "$version" ]; then
        say "Reinstalled Ukemi $version.$2"
    else
        say "Updated Ukemi $1 → $version.$2"
    fi
    say "Run this command again to update."
}

# --- Linux ---

# Each version lives in its own folder, and `current` links to the installed one. An update
# unpacks the new version next to the running one and switches the link, so a running Ukemi keeps
# its files until it restarts.
app_dir="$data_dir/ukemi"
versions_dir="$app_dir/versions"
current="$app_dir/current"
app_program="$current/ukemi"
# The command, the menu entry and the app's restart after an update all start this script, which
# starts the current version.
launcher="$app_dir/bin/ukemi"
# Earlier versions of this script installed this AppImage. A moved install keeps the name as a
# link to the launcher: the old app's Restart button, after it updated itself, starts it.
legacy="$app_dir/Ukemi.AppImage"
desktop_file="$data_dir/applications/ukemi.desktop"
icon_root="$data_dir/icons/hicolor"
proc=/proc
apparmor_dir=/etc/apparmor.d
tty=/dev/tty
profile_name="ukemi-$(id -u)"
profile_target="$apparmor_dir/$profile_name"
profile_copy="$app_dir/apparmor-profile"

# The Exec key of a desktop entry. A % is doubled. Paths with characters that need more escaping
# are refused.
desktop_exec() {
    case "$1" in
        *[\"\`\$\\]*) die "cannot write a desktop entry for $1 (it contains \", \`, \$ or \\)" ;;
        *[!A-Za-z0-9/._+-]*) printf '"%s"' "$(printf '%s' "$1" | sed 's/%/%%/g')" ;;
        *) printf '%s' "$1" ;;
    esac
}

# Other installers may have left an icon cache here, which hides icons it does not list.
refresh_icon_cache() {
    [ -f "$icon_root/icon-theme.cache" ] || return 0
    for tool in gtk-update-icon-cache gtk4-update-icon-cache; do
        if has "$tool"; then
            "$tool" -q -f -t "$icon_root" 2>/dev/null && return 0
        fi
    done
    rm -f -- "$icon_root/icon-theme.cache"
}

remove_icons() {
    rm -f -- "$icon_root"/*/apps/ukemi.png "$icon_root/scalable/apps/ukemi.svg"
}

# The app carries its icons in resources/. Icons of other sizes, from an AppImage install, go.
# The app is already in place by then, so a missing icon only costs the icon.
install_icons() { # APP_DIR
    remove_icons
    mkdir -p "$icon_root/256x256/apps" "$icon_root/scalable/apps"
    cp "$1/resources/icon.png" "$icon_root/256x256/apps/ukemi.png" ||
        say "The app has no icon.png, so the menu entry has no icon." >&2
    cp "$1/resources/icon.svg" "$icon_root/scalable/apps/ukemi.svg" ||
        say "The app has no icon.svg, so the menu entry has no scalable icon." >&2
    refresh_icon_cache
}

# Two installs at once, like the updater and a manual run, would unpack into the same folder. The
# lock is a folder, made in one step. One left behind by a killed install is taken over.
lock="$app_dir/.install-lock"
take_lock() {
    mkdir -p "$app_dir"
    if ! mkdir "$lock" 2>/dev/null; then
        holder="$(cat "$lock/pid" 2>/dev/null || true)"
        if [ -z "$holder" ] || kill -0 "$holder" 2>/dev/null; then
            die "another install of Ukemi is running${holder:+ (process $holder)}. If none is, remove $lock. Nothing was installed."
        fi
        rm -rf -- "$lock"
        mkdir "$lock" 2>/dev/null || die "another install of Ukemi is running. Nothing was installed."
    fi
    locked=1
    printf '%s\n' "$$" >"$lock/pid"
}

# Ubuntu 23.10 and later let only programs with an AppArmor profile use user namespaces, which
# Chromium's sandbox needs, so Electron aborts at startup without one. The deb installs such a
# profile. Here it takes sudo once: the profile covers every version folder, so updates need
# nothing more.
userns_restricted() {
    [ "$(cat "$proc/sys/kernel/apparmor_restrict_unprivileged_userns" 2>/dev/null)" = 1 ]
}

write_userns_profile() { # VERSIONS_DIR
    cat >"$profile_copy" <<EOF
abi <abi/4.0>,
include <tunables/global>

profile $profile_name $1/*/ukemi flags=(unconfined) {
  userns,

  include if exists <local/$profile_name>
}
EOF
}

sandbox_hint() {
    say ""
    say "Until then Ukemi runs without its sandbox. To turn the sandbox on, install the profile with:"
    say "  sudo install -m 644 $profile_copy $profile_target && sudo apparmor_parser -r $profile_target"
}

sh_quote() {
    printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

# Without the profile, Electron would abort at startup, so the app then starts without its
# sandbox. Replaced in one step, so a launch meanwhile never reads half a script.
write_launcher() {
    mkdir -p "${launcher%/*}"
    cat >"$launcher.new" <<EOF
#!/bin/sh
# Installed by the Ukemi install script. Starts the installed version of Ukemi.
if [ "\$(cat $(sh_quote "$proc/sys/kernel/apparmor_restrict_unprivileged_userns") 2>/dev/null)" = 1 ] &&
    [ ! -f $(sh_quote "$profile_target") ]; then
    exec $(sh_quote "$app_program") --no-sandbox "\$@"
fi
exec $(sh_quote "$app_program") "\$@"
EOF
    chmod 755 "$launcher.new"
    mv -f -- "$launcher.new" "$launcher"
}

# The updater runs this script with no one to answer, at most in the terminal Ukemi started from.
can_ask() {
    [ -z "${UKEMI_SHA256SUMS:-}" ] && has sudo && has apparmor_parser && (: <"$tty") 2>/dev/null
}

allow_sandbox() {
    userns_restricted || return 0
    # AppArmor matches the program's real path, and these characters need no quoting in a profile.
    real="$(cd "$versions_dir" && pwd -P)"
    case "$real" in
        *[!A-Za-z0-9/._+-]*)
            say ""
            say "Ukemi runs without its sandbox: AppArmor allows the sandbox only with a profile, and none can be written for $real."
            return 0
            ;;
    esac
    write_userns_profile "$real"
    if [ -f "$profile_target" ] && [ "$(cat "$profile_target")" = "$(cat "$profile_copy")" ]; then
        return 0
    fi
    if ! can_ask; then
        sandbox_hint
        return 0
    fi
    say ""
    say "Ubuntu runs Ukemi's sandbox only with an AppArmor profile. Installing it takes sudo, once:"
    say "  $profile_target"
    printf 'Install it now? [Y/n] '
    read -r answer <"$tty" || answer=n
    case "$answer" in
        "" | [yY]*) ;;
        *)
            sandbox_hint
            return 0
            ;;
    esac
    if sudo install -m 644 "$profile_copy" "$profile_target" <"$tty" &&
        sudo apparmor_parser -r "$profile_target" <"$tty"; then
        say "Installed the AppArmor profile."
    else
        sandbox_hint
    fi
}

# The version folders that running processes started from. The kernel resolves each process's
# program, so the folder is compared by its real path. Other users' processes cannot be read.
running_versions() {
    real="$(cd "$versions_dir" 2>/dev/null && pwd -P)" || return 0
    # One file per call: BusyBox readlink takes no more.
    for exe in "$proc"/[0-9]*/exe; do
        readlink "$exe" 2>/dev/null || true
    done |
        awk -v prefix="$real/" 'index($0, prefix) == 1 {
            rest = substr($0, length(prefix) + 1)
            if (sub(/\/.*/, "", rest)) print rest
        }'
}

# Removes every version but the installed one and those still running, and what an interrupted
# install left behind.
prune_versions() {
    keep="$(readlink "$current")"
    keep="${keep##*/}"
    nl='
'
    running="$nl$(running_versions)$nl"
    for dir in "$versions_dir"/* "$versions_dir"/.[!.]*; do
        [ -e "$dir" ] || continue
        name="${dir##*/}"
        [ "$name" = "$keep" ] && continue
        case "$running" in *"$nl$name$nl"*) continue ;; esac
        rm -rf -- "$dir"
    done
}

# Points LINK at TARGET in one step, so nothing ever sees LINK missing.
replace_link() { # TARGET LINK
    rm -f -- "$2.new"
    ln -s "$1" "$2.new"
    mv -Tf -- "$2.new" "$2"
}

# Unpacks the downloaded app into versions/.VERSION.new. electron-builder puts it in one
# top-level folder.
unpack() { # ARCHIVE
    staging="$versions_dir/.$version.new"
    rm -rf -- "$staging"
    mkdir -p "$staging"
    tar -xzf "$1" -C "$staging" --strip-components=1 ||
        die "cannot unpack $asset. Nothing was installed."
    [ -f "$staging/ukemi" ] && [ -x "$staging/ukemi" ] ||
        die "$asset does not contain the ukemi program. Nothing was installed."
}

install_linux() {
    if [ -e /usr/bin/ukemi ] || [ -e /opt/Ukemi ]; then
        die "Ukemi is installed as a system package (/usr/bin/ukemi). Update it with your package manager, or remove the package before using this script."
    fi
    case "$(uname -m)" in
        x86_64 | amd64) asset="Ukemi-$version-linux-x64.tar.gz" ;;
        aarch64 | arm64) asset="Ukemi-$version-linux-arm64.tar.gz" ;;
        *) die "there is no Ukemi build for $(uname -m), only for x86_64 and aarch64" ;;
    esac
    has tar || die "needs tar to unpack the app"

    exec_path="$(desktop_exec "$launcher")"
    moving=0
    if [ -f "$legacy" ] && [ ! -L "$legacy" ]; then
        moving=1
        previous="$(marker_version || true)"
    fi

    download "$asset" " Releases that only have an AppImage cannot be installed with this script."
    unpack "$tmp/$asset"
    rm -f -- "$tmp/$asset"

    # A running copy of the same version, when forced, keeps its files under another name.
    if [ -e "$versions_dir/$version" ]; then
        mv -- "$versions_dir/$version" "$versions_dir/.$version.old.$$"
    fi
    mv -- "$staging" "$versions_dir/$version"
    replace_link "versions/$version" "$current"

    write_launcher
    mkdir -p "$bin_dir"
    ln -sfn "$launcher" "$command_path"

    # The running AppImage keeps its mount when its file is replaced.
    if [ "$moving" = 1 ]; then
        replace_link bin/ukemi "$legacy"
    fi

    # Keep the file name ukemi.desktop and StartupWMClass=ukemi: the desktop matches the open
    # window to this entry by that name, and shows a generic icon otherwise.
    mkdir -p "${desktop_file%/*}"
    cat >"$desktop_file" <<EOF
[Desktop Entry]
Type=Application
Name=Ukemi
GenericName=Jujutsu Client
Comment=Jujutsu (jj) GUI
Exec=$exec_path %U
Icon=ukemi
Terminal=false
Categories=Development;RevisionControl;
Keywords=jj;jujutsu;git;vcs;version control;source control;
StartupWMClass=ukemi
EOF
    install_icons "$versions_dir/$version"
    write_marker
    prune_versions
    allow_sandbox

    if [ "$moving" = 1 ]; then
        say "Replaced the AppImage with the unpacked app in $app_dir."
    fi
    finish "$previous" " Restart Ukemi to use the new version."
}

uninstall_linux() {
    [ -e "$current" ] || [ -L "$current" ] || [ -e "$legacy" ] || [ -e "$marker" ] ||
        die "Ukemi is not installed in $app_dir"
    [ -z "$(running_versions)" ] || die "Ukemi is running. Quit it, then run this again."
    if [ -L "$command_path" ]; then
        case "$(readlink "$command_path")" in
            "$launcher" | "$legacy") rm -f -- "$command_path" ;;
        esac
    fi
    rm -rf -- "$versions_dir" "${launcher%/*}"
    rm -f -- "$current" "$legacy" "$marker" "$desktop_file" "$profile_copy"
    remove_icons
    refresh_icon_cache
    rmdir -- "$app_dir" 2>/dev/null || true
    say "Removed Ukemi. Your settings in ${XDG_CONFIG_HOME:-$HOME/.config}/Ukemi stay."
    if [ -f "$profile_target" ]; then
        say "Remove its AppArmor profile with: sudo apparmor_parser -R $profile_target && sudo rm $profile_target"
    fi
}

# The marker stays behind when the app is deleted by hand. An AppImage install reports no version,
# so it is always moved.
installed_version_linux() {
    [ -e "$app_program" ] && [ -e "$launcher" ] && marker_version
}

# --- macOS ---

# An existing install is updated where it is.
mac_app() {
    for dir in /Applications "$HOME/Applications"; do
        if [ -d "$dir/Ukemi.app" ]; then
            printf '%s\n' "$dir/Ukemi.app"
            return
        fi
    done
    if [ -w /Applications ]; then
        printf '%s\n' /Applications/Ukemi.app
    else
        printf '%s\n' "$HOME/Applications/Ukemi.app"
    fi
}

# Opens Ukemi with the folders given. `open -n` starts a second instance, which hands its
# arguments to a running one and quits. It runs from /, so relative paths become absolute.
write_mac_launcher() { # APP
    mkdir -p "$bin_dir"
    cat >"$command_path" <<EOF
#!/bin/sh
# Installed by the Ukemi install script.
for arg do
  shift
  case \$arg in
    -* | /*) ;;
    *) arg="\$PWD/\$arg" ;;
  esac
  set -- "\$@" "\$arg"
done
exec open -n -a '$1' --args "\$@"
EOF
    chmod 755 "$command_path"
}

# Under Rosetta, uname reports x86_64 on an Apple silicon Mac.
mac_arch() {
    if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = 1 ]; then
        printf '%s\n' arm64
    else
        uname -m
    fi
}

install_mac() {
    arch="$(mac_arch)"
    case "$arch" in
        arm64) asset="Ukemi-$version-arm64.dmg" ;;
        x86_64) asset="Ukemi-$version-x64.dmg" ;;
        *) die "there is no Ukemi build for $arch" ;;
    esac
    app="$(mac_app)"
    case "$app" in
        *\'*) die "cannot install to $app (it contains ')" ;;
    esac
    # Electron starts helper processes from the bundle, so a running Ukemi breaks when it changes.
    if pgrep -xq Ukemi; then
        die "Ukemi is running. Quit it, then run this again."
    fi

    download "$asset"
    mkdir -p "$tmp/mount"
    hdiutil attach -nobrowse -readonly -noautoopen -quiet -mountpoint "$tmp/mount" "$tmp/$asset" ||
        die "cannot open $asset. Nothing was installed."
    mounted="$tmp/mount"
    [ -d "$mounted/Ukemi.app" ] || die "$asset has no Ukemi.app. Nothing was installed."

    apps="${app%/*}"
    mkdir -p "$apps"
    rm -rf -- "$apps/.Ukemi.app.new"
    # ditto keeps the bundle's symlinks, file modes and signatures.
    ditto "$mounted/Ukemi.app" "$apps/.Ukemi.app.new" ||
        die "cannot write to $apps. Nothing was installed."
    hdiutil detach -quiet "$mounted" || true
    mounted=""
    rm -rf -- "$app"
    mv "$apps/.Ukemi.app.new" "$app"
    # curl does not quarantine what it downloads, but wget or a proxy might.
    xattr -dr com.apple.quarantine "$app" 2>/dev/null || true

    write_mac_launcher "$app"
    write_marker
    say "Installed $app"
    finish "$previous" ""
}

uninstall_mac() {
    app="$(mac_app)"
    [ -d "$app" ] || [ -e "$marker" ] || die "Ukemi is not installed"
    if pgrep -xq Ukemi; then
        die "Ukemi is running. Quit it, then run this again."
    fi
    rm -rf -- "$app"
    if [ -f "$command_path" ] && grep -q 'Installed by the Ukemi install script' "$command_path"; then
        rm -f -- "$command_path"
    fi
    rm -f -- "$marker"
    rmdir -- "${marker%/*}" 2>/dev/null || true
    say "Removed Ukemi. Your settings in ~/Library/Application Support/Ukemi stay."
}

installed_version_mac() {
    plist="$(mac_app)/Contents/Info.plist"
    [ -f "$plist" ] && /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist" 2>/dev/null
}

# --- main ---

case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=mac ;;
    *) die "this script installs Ukemi on Linux and macOS. For Windows, download the installer from $repo/releases/latest" ;;
esac

if [ "$uninstall" = 1 ]; then
    "uninstall_$os"
    exit 0
fi

if [ -n "${UKEMI_VERSION:-}" ]; then
    version="${UKEMI_VERSION#v}"
else
    version="$(latest_version)"
fi

previous="$("installed_version_$os" || true)"
if [ "$previous" = "$version" ] && [ "$force" != 1 ]; then
    say "Ukemi $version is already installed. Use --force to reinstall it."
    exit 0
fi

tmp="$(mktemp -d)"
mounted=""
locked=""
cleanup() {
    if [ -n "$mounted" ]; then
        hdiutil detach -quiet -force "$mounted" 2>/dev/null || true
    fi
    if [ -n "$locked" ]; then
        rm -rf -- "$lock"
        rmdir -- "$app_dir" 2>/dev/null || true
    fi
    rm -rf -- "$tmp"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if [ "$os" = linux ]; then
    take_lock
fi

"install_$os"
