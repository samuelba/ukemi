import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'

export function glabConfigFile(env: NodeJS.ProcessEnv, home: string): string {
  const dir =
    env.GLAB_CONFIG_DIR ||
    (env.XDG_CONFIG_HOME
      ? path.join(env.XDG_CONFIG_HOME, 'glab-cli')
      : path.join(home, '.config', 'glab-cli'))
  return path.join(dir, 'config.yml')
}

export function glabKnowsHost(
  host: string,
  options: {
    env?: NodeJS.ProcessEnv
    home?: string
    readFile?: (file: string) => string
  } = {},
): boolean {
  const file = glabConfigFile(options.env ?? process.env, options.home ?? homedir())
  try {
    const text = (options.readFile ?? ((filePath: string) => readFileSync(filePath, 'utf8')))(file)
    return configHasHost(text, host)
  } catch {
    return false
  }
}

export function configHasHost(text: string, host: string): boolean {
  try {
    const parsed = parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || !('hosts' in parsed)) {
      return false
    }
    const hosts = parsed.hosts
    if (!hosts || typeof hosts !== 'object') {
      return false
    }
    return Object.keys(hosts).some((name) => name.toLowerCase() === host.toLowerCase())
  } catch {
    return false
  }
}
