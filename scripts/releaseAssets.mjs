// Picks the desktop download links of a GitHub release by file name. Used by
// updateWebsiteRelease.mjs; kept apart so the patterns can be tested.
//
// The keys without a suffix are the x64 files, as they were before arm64 builds existed, so
// older website data keeps its meaning. electron-builder adds the arch to a name only when it is
// not x64, and deb, rpm, snap and Flatpak each spell the arch their own way.
export const ASSET_PATTERNS = {
  exe: /\.exe$/i,
  dmgArm64: /-arm64\.dmg$/i,
  dmgX64: /-x64\.dmg$/i,
  appimage: /(?<!-arm64)\.AppImage$/i,
  appimageArm64: /-arm64\.AppImage$/i,
  deb: /_amd64\.deb$/i,
  debArm64: /_arm64\.deb$/i,
  rpm: /\.x86_64\.rpm$/i,
  rpmArm64: /\.aarch64\.rpm$/i,
  snap: /_amd64\.snap$/i,
  snapArm64: /_arm64\.snap$/i,
  flatpak: /-x86_64\.flatpak$/i,
  flatpakArm64: /-aarch64\.flatpak$/i,
}

// Without these the page would show a dead main button.
export const REQUIRED_ASSETS = ['exe', 'dmgArm64', 'dmgX64', 'appimage', 'appimageArm64']

/**
 * @param {{ name: string, browser_download_url: string }[]} releaseAssets
 * @returns {{ assets: Record<string, string>, missing: string[] }}
 */
export function pickAssets(releaseAssets) {
  const assets = {}
  for (const [key, pattern] of Object.entries(ASSET_PATTERNS)) {
    const asset = releaseAssets.find((a) => pattern.test(a.name))
    if (asset) assets[key] = asset.browser_download_url
  }
  const missing = REQUIRED_ASSETS.filter((key) => !assets[key])
  return { assets, missing }
}
