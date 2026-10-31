import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'
import { isSafeHttpsHost } from './hostName'

export function ghConfigFile(
  env: NodeJS.ProcessEnv,
  home: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (env.GH_CONFIG_DIR) {
    return path.join(env.GH_CONFIG_DIR, 'hosts.yml')
  }
  if (env.XDG_CONFIG_HOME) {
    return path.join(env.XDG_CONFIG_HOME, 'gh', 'hosts.yml')
  }
  if (platform === 'win32' && env.AppData) {
    return path.join(env.AppData, 'GitHub CLI', 'hosts.yml')
  }
  return path.join(home, '.config', 'gh', 'hosts.yml')
}

interface ReadOptions {
  env?: NodeJS.ProcessEnv
  home?: string
  readFile?: (file: string) => string
}

// Only host names are read. The token stays in the keyring or in the file, untouched.
export function configHosts(text: string): string[] {
  try {
    const parsed = parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return []
    }
    return Object.keys(parsed)
      .map((name) => name.toLowerCase())
      .filter(isSafeHttpsHost)
  } catch {
    return []
  }
}

export function ghHosts(options: ReadOptions = {}): string[] {
  const file = ghConfigFile(options.env ?? process.env, options.home ?? homedir())
  try {
    return configHosts(
      (options.readFile ?? ((filePath: string) => readFileSync(filePath, 'utf8')))(file),
    )
  } catch {
    return []
  }
}

export function ghKnowsHost(host: string, options: ReadOptions = {}): boolean {
  return ghHosts(options).includes(host.toLowerCase())
}
