import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'
import { isSafeHttpsHost } from './hostName'
import { cliTokenEnv, hostConfigEnv } from '../util/hostProcess'

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
  // The variables the CLI runs with, for its token variables.
  tokenEnv?: NodeJS.ProcessEnv
  home?: string
  readFile?: (file: string) => string
}

function isSet(env: NodeJS.ProcessEnv, names: readonly string[]): boolean {
  return names.some((name) => !!env[name])
}

const GH_TOKENS = ['GH_TOKEN', 'GITHUB_TOKEN']
const GH_ENTERPRISE_TOKENS = ['GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']

// gh takes GH_TOKEN for github.com and *.ghe.com, as in Codespaces, and GH_ENTERPRISE_TOKEN for
// an Enterprise Server. Only whether one is set is read, never its value.
export function ghEnvToken(host: string, env: NodeJS.ProcessEnv): boolean {
  const name = host.toLowerCase()
  if (name === 'github.com' || name.endsWith('.ghe.com')) {
    return isSet(env, GH_TOKENS)
  }
  return isSet(env, GH_ENTERPRISE_TOKENS)
}

// The Enterprise host that GH_HOST names for an enterprise token.
function ghEnvHost(env: NodeJS.ProcessEnv): string | null {
  const host = env.GH_HOST?.trim().toLowerCase()
  return host && isSafeHttpsHost(host) && isSet(env, GH_ENTERPRISE_TOKENS) ? host : null
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

function fileHosts(options: ReadOptions): string[] {
  const file = ghConfigFile(options.env ?? hostConfigEnv(), options.home ?? homedir())
  try {
    return configHosts(
      (options.readFile ?? ((filePath: string) => readFileSync(filePath, 'utf8')))(file),
    )
  } catch {
    return []
  }
}

export function ghHosts(options: ReadOptions = {}): string[] {
  const hosts = fileHosts(options)
  const envHost = ghEnvHost(options.tokenEnv ?? cliTokenEnv())
  return envHost && !hosts.includes(envHost) ? [...hosts, envHost] : hosts
}

export function ghKnowsHost(host: string, options: ReadOptions = {}): boolean {
  return (
    ghEnvToken(host, options.tokenEnv ?? cliTokenEnv()) ||
    fileHosts(options).includes(host.toLowerCase())
  )
}
