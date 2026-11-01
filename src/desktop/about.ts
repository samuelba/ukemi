import type { AboutInfo } from '../../shared/desktopProtocol'
import packageJson from '../../package.json'

export interface Runtime {
  versions: { electron?: string; chrome?: string; node?: string }
  platform: NodeJS.Platform
  arch: string
  release: string
  userData: string
}

// package.json names the git URL. The About dialog links to the repository page.
function repositoryPage(url: string): string {
  return url.replace(/^git\+/, '').replace(/\.git$/, '')
}

// What Help > About shows. The version comes from package.json, the one release-please bumps.
export function aboutInfo(
  jj: { path: string | null; version: string | null },
  runtime: Runtime,
): AboutInfo {
  return {
    name: 'Ukemi',
    description: 'A graphical client for Jujutsu (jj).',
    version: packageJson.version,
    license: packageJson.license,
    copyright: `Copyright © ${new Date().getFullYear()} Samuel Bachmann`,
    website: packageJson.homepage,
    repository: repositoryPage(packageJson.repository.url),
    jj: jj.path ? { path: jj.path, version: jj.version ?? 'unknown' } : null,
    electron: runtime.versions.electron ?? 'unknown',
    chromium: runtime.versions.chrome ?? 'unknown',
    node: runtime.versions.node ?? 'unknown',
    os: `${runtime.platform} ${runtime.arch} ${runtime.release}`,
    userData: runtime.userData,
  }
}

// The facts as plain text, to paste into an issue.
export function aboutText(info: AboutInfo): string {
  return [
    `${info.name} ${info.version}`,
    `jj: ${info.jj ? `${info.jj.version} (${info.jj.path})` : 'not found'}`,
    `Electron: ${info.electron}`,
    `Chromium: ${info.chromium}`,
    `Node: ${info.node}`,
    `OS: ${info.os}`,
  ].join('\n')
}
