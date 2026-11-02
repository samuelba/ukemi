import { flatpakAppId } from '../util/hostProcess'

export interface TerminalCommand {
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
}

const TERMINAL_ENV = { TERM: 'xterm-256color', COLORTERM: 'truecolor' }

// Variables that belong to the app and must not leak into the user's shell.
function isAppVariable(name: string): boolean {
  return name === 'ELECTRON_RUN_AS_NODE' || name.startsWith('UKEMI_')
}

// The user's shell for a terminal tab. From a Flatpak it runs on the host, with the host's shell.
export function terminalCommand(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): TerminalCommand {
  const clean = Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && !isAppVariable(entry[0]),
    ),
  )
  if (flatpakAppId(env)) {
    return {
      file: 'flatpak-spawn',
      args: [
        '--host',
        '--watch-bus',
        `--directory=${cwd}`,
        ...Object.entries(TERMINAL_ENV).map(([key, value]) => `--env=${key}=${value}`),
        'sh',
        '-c',
        'exec "${SHELL:-/bin/bash}" -l',
      ],
      cwd,
      env: { ...clean, ...TERMINAL_ENV },
    }
  }
  if (platform === 'win32') {
    return { file: 'powershell.exe', args: [], cwd, env: { ...clean, ...TERMINAL_ENV } }
  }
  return {
    file: env.SHELL || '/bin/bash',
    args: platform === 'darwin' ? ['-l'] : [],
    cwd,
    env: { ...clean, ...TERMINAL_ENV },
  }
}
