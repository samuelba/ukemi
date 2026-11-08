import { describe, expect, it } from 'vitest'
import { pickAssets } from '../../scripts/releaseAssets.mjs'

const base = 'https://github.com/samuelba/ukemi/releases/download/v1.0.0/'

// The names electron-builder gives each installer, for both Linux architectures.
const names = [
  'Ukemi.Setup.1.0.0.exe',
  'Ukemi-1.0.0-arm64.dmg',
  'Ukemi-1.0.0-x64.dmg',
  'Ukemi-1.0.0-arm64.AppImage',
  'Ukemi-1.0.0.AppImage',
  'ukemi_1.0.0_arm64.deb',
  'ukemi_1.0.0_amd64.deb',
  'ukemi-1.0.0.aarch64.rpm',
  'ukemi-1.0.0.x86_64.rpm',
  'ukemi-jj_1.0.0_arm64.snap',
  'ukemi-jj_1.0.0_amd64.snap',
  'Ukemi-1.0.0-aarch64.flatpak',
  'Ukemi-1.0.0-x86_64.flatpak',
]
const release = (files: string[]) =>
  files.map((name) => ({ name, browser_download_url: base + name }))

describe('pickAssets', () => {
  it('keeps each architecture apart, whatever the order of the assets', () => {
    for (const files of [names, [...names].reverse()]) {
      const { assets, missing } = pickAssets(release(files))
      expect(missing).toEqual([])
      expect(assets).toEqual({
        exe: base + 'Ukemi.Setup.1.0.0.exe',
        dmgArm64: base + 'Ukemi-1.0.0-arm64.dmg',
        dmgX64: base + 'Ukemi-1.0.0-x64.dmg',
        appimage: base + 'Ukemi-1.0.0.AppImage',
        appimageArm64: base + 'Ukemi-1.0.0-arm64.AppImage',
        deb: base + 'ukemi_1.0.0_amd64.deb',
        debArm64: base + 'ukemi_1.0.0_arm64.deb',
        rpm: base + 'ukemi-1.0.0.x86_64.rpm',
        rpmArm64: base + 'ukemi-1.0.0.aarch64.rpm',
        snap: base + 'ukemi-jj_1.0.0_amd64.snap',
        snapArm64: base + 'ukemi-jj_1.0.0_arm64.snap',
        flatpak: base + 'Ukemi-1.0.0-x86_64.flatpak',
        flatpakArm64: base + 'Ukemi-1.0.0-aarch64.flatpak',
      })
    }
  })

  it('reports a missing arm64 AppImage', () => {
    const { assets, missing } = pickAssets(
      release(names.filter((name) => name !== 'Ukemi-1.0.0-arm64.AppImage')),
    )
    expect(missing).toEqual(['appimageArm64'])
    expect(assets.appimage).toBe(base + 'Ukemi-1.0.0.AppImage')
  })

  it('leaves optional formats out when a release has none', () => {
    const { assets } = pickAssets(release(names.filter((name) => !name.endsWith('.snap'))))
    expect(assets.snap).toBeUndefined()
    expect(assets.snapArm64).toBeUndefined()
  })
})
