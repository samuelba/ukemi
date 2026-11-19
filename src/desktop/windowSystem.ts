// Electron uses native Wayland whenever WAYLAND_DISPLAY is set. Where Wayland cannot paint, as in
// some virtual machines, no window ever becomes ready to show and Ukemi seems not to start. Ukemi
// then falls back to X11 through XWayland. Chromium picks the platform before main.js runs, so the
// switch takes a restart.

export const X11_FALLBACK_KEY = 'x11Fallback'
export const FIRST_PAINT_TIMEOUT_MS = 15_000
export const X11_SWITCH = '--ozone-platform=x11'

const PLATFORM_SWITCH = /^--ozone-platform(-hint)?(=|$)/

// Flatpak's fallback-x11 grants no X11 socket on a Wayland session, so X11 would not work there.
export function canFallBackToX11(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  args: readonly string[],
): boolean {
  return (
    platform === 'linux' &&
    Boolean(env.WAYLAND_DISPLAY) &&
    Boolean(env.DISPLAY) &&
    !env.FLATPAK_ID &&
    !args.some((arg) => PLATFORM_SWITCH.test(arg))
  )
}

export function x11Args(args: readonly string[]): string[] {
  return [...args, X11_SWITCH]
}

// An AppImage's mount goes away when it exits, so it restarts from the AppImage file.
export function relaunchExecutable(env: NodeJS.ProcessEnv, execPath: string): string {
  return env.APPIMAGE ?? execPath
}
