#!/bin/sh
# Installs or updates the Ukemi desktop app for the current user, without sudo:
#
#   curl -fsSL https://samuelba.dev/ukemi/install.sh | sh
#
# Running it again updates to the latest release. Options (after `sh -s --` when piped):
#   --force      reinstall even when this version is already installed
#   --uninstall  remove Ukemi; settings and sign-ins stay
# Environment: UKEMI_VERSION pins a release (e.g. 0.17.0). UKEMI_FORCE=1 and UKEMI_UNINSTALL=1 do
# the same as the options.
#
# Linux: the AppImage in ~/.local/share/ukemi, the `ukemi` command in ~/.local/bin, and the app
# menu entry and icon under ~/.local/share.
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
        wget -q -O "$2" "$1"
    else
        die "needs curl or wget"
    fi
}

latest_version() {
    if has curl; then
        url="$(curl -fsSLI --proto '=https' -o /dev/null -w '%{url_effective}' "$repo/releases/latest")"
    elif has wget; then
        url="$(wget -q -S --spider --max-redirect=0 "$repo/releases/latest" 2>&1 |
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

# Downloads a release file to $tmp and checks it against the release's SHA256SUMS.
download() { # NAME
    say "Downloading $1"
    fetch "$repo/releases/download/v$version/SHA256SUMS" "$tmp/SHA256SUMS" ||
        die "cannot get the checksums of v$version. A new release takes a few minutes to build, so try again soon. Releases before 0.17.0 have none and cannot be installed this way. Nothing was installed."
    expected="$(awk -v name="$1" '$2 == name || $2 == "*" name { print $1 }' "$tmp/SHA256SUMS")"
    [ -n "$expected" ] || die "$1 is missing from the release v$version. Nothing was installed."
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

app_dir="$data_dir/ukemi"
appimage="$app_dir/Ukemi.AppImage"
desktop_file="$data_dir/applications/ukemi.desktop"
icon_root="$data_dir/icons/hicolor"

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

has_fuse2() {
    if has ldconfig && ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; then
        return 0
    fi
    for lib in /usr/lib*/libfuse.so.2 /usr/lib/*/libfuse.so.2 /lib*/libfuse.so.2 /lib/*/libfuse.so.2; do
        [ -e "$lib" ] && return 0
    done
    return 1
}

# The AppImage carries its icons. Extracting them runs the downloaded runtime, without FUSE.
install_icons() {
    (cd "$tmp" && "$tmp/Ukemi.AppImage" --appimage-extract 'usr/share/icons/hicolor/*' >/dev/null 2>&1) || true
    found=0
    for icon in "$tmp"/squashfs-root/usr/share/icons/hicolor/*/apps/ukemi.png; do
        [ -f "$icon" ] || continue
        size="${icon%/apps/ukemi.png}"
        size="${size##*/}"
        mkdir -p "$icon_root/$size/apps"
        cp "$icon" "$icon_root/$size/apps/ukemi.png"
        found=1
    done
    [ "$found" = 1 ] || say "Could not extract the icon, so the app menu shows a generic one."
    refresh_icon_cache
}

install_linux() {
    if [ -e /usr/bin/ukemi ] || [ -e /opt/Ukemi ]; then
        die "Ukemi is installed as a system package (/usr/bin/ukemi). Update it with your package manager, or remove the package before using this script."
    fi
    case "$(uname -m)" in
        x86_64 | amd64) asset="Ukemi-$version.AppImage" ;;
        aarch64 | arm64) asset="Ukemi-$version-arm64.AppImage" ;;
        *) die "there is no Ukemi build for $(uname -m), only for x86_64 and aarch64" ;;
    esac

    exec_path="$(desktop_exec "$appimage")"

    download "$asset"
    mv "$tmp/$asset" "$tmp/Ukemi.AppImage"
    chmod 755 "$tmp/Ukemi.AppImage"

    # Written next to the old AppImage and renamed over it, so a running Ukemi keeps working.
    mkdir -p "$app_dir"
    cp "$tmp/Ukemi.AppImage" "$app_dir/.Ukemi.AppImage.new"
    chmod 755 "$app_dir/.Ukemi.AppImage.new"
    mv -f "$app_dir/.Ukemi.AppImage.new" "$appimage"

    mkdir -p "$bin_dir"
    ln -sfn "$appimage" "$command_path"

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
    install_icons
    write_marker

    finish "$previous" " Restart Ukemi to use the new version."
    if ! has_fuse2; then
        say ""
        say "The AppImage needs FUSE 2 to start: fuse-libs on Fedora, libfuse2t64 on Ubuntu 24.04,"
        say "libfuse2 on older Debian and Ubuntu."
    fi
}

uninstall_linux() {
    [ -e "$appimage" ] || [ -e "$marker" ] || die "Ukemi is not installed in $app_dir"
    if [ -L "$command_path" ] && [ "$(readlink "$command_path")" = "$appimage" ]; then
        rm -f -- "$command_path"
    fi
    rm -f -- "$appimage" "$marker" "$desktop_file" "$icon_root"/*/apps/ukemi.png
    refresh_icon_cache
    rmdir -- "$app_dir" 2>/dev/null || true
    say "Removed Ukemi. Your settings in ${XDG_CONFIG_HOME:-$HOME/.config}/Ukemi stay."
}

# The marker stays behind when the AppImage is deleted by hand.
installed_version_linux() {
    [ -e "$appimage" ] && marker_version
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
cleanup() {
    if [ -n "$mounted" ]; then
        hdiutil detach -quiet -force "$mounted" 2>/dev/null || true
    fi
    rm -rf -- "$tmp"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

"install_$os"
