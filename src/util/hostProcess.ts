import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

type Env = Readonly<Record<string, string | undefined>>

// The Flatpak app id when Ukemi runs inside a Flatpak sandbox.
export function flatpakAppId(env: Env = process.env): string | null {
  return env.FLATPAK_ID || null
}

// A folder that the host and every instance of the sandbox see at the same path. jj writes the
// temporary files of a split there, and askpass keeps its socket there.
export function sharedTempDir(env: Env = process.env): string {
  if (!flatpakAppId(env)) {
    return tmpdir()
  }
  return join(env.XDG_CACHE_HOME ?? join(env.HOME ?? homedir(), '.cache'), 'tmp')
}

// The environment as the host's tools see it, for reading their files from the sandbox. A
// Flatpak points XDG_CONFIG_HOME at the app's own folder and keeps the host's value, if the host
// set one, in HOST_XDG_CONFIG_HOME. Without one the host uses ~/.config.
export function hostConfigEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!flatpakAppId(env)) {
    return env
  }
  const rest = Object.fromEntries(
    Object.entries(env).filter(
      ([key]) => key !== 'XDG_CONFIG_HOME' && key !== 'HOST_XDG_CONFIG_HOME',
    ),
  )
  const host = env.HOST_XDG_CONFIG_HOME
  return host ? { ...rest, XDG_CONFIG_HOME: host } : rest
}

export interface HostSpawn {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
}

// How to run a program of the user's machine, like jj, git or gh. Inside a Flatpak they only
// exist on the host, so they run through flatpak-spawn with just the variables Ukemi sets: the
// host keeps its own PATH and home setup.
export function hostSpawn(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: Readonly<Record<string, string>> } = {},
  env: Env = process.env,
): HostSpawn {
  const extra = options.env ?? {}
  if (!flatpakAppId(env)) {
    return { command, args: [...args], env: { ...env, ...extra } }
  }
  const forwarded = { TMPDIR: sharedTempDir(env), ...extra }
  return {
    command: 'flatpak-spawn',
    args: [
      '--host',
      // Ends the host process when the app quits, as for a child process.
      '--watch-bus',
      ...(options.cwd ? [`--directory=${options.cwd}`] : []),
      ...Object.entries(forwarded).map(([key, value]) => `--env=${key}=${value}`),
      command,
      ...args,
    ],
    env: { ...env },
  }
}
