import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'
import { cliTokenEnv, hostConfigEnv } from '../util/hostProcess'

export function glabConfigFile(env: NodeJS.ProcessEnv, home: string): string {
  const dir =
    env.GLAB_CONFIG_DIR ||
    (env.XDG_CONFIG_HOME
      ? path.join(env.XDG_CONFIG_HOME, 'glab-cli')
      : path.join(home, '.config', 'glab-cli'))
  return path.join(dir, 'config.yml')
}

const GLAB_TOKENS = ['GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'OAUTH_TOKEN']
const GLAB_HOSTS = ['GITLAB_HOST', 'GL_HOST', 'GITLAB_URI']

// The host glab's token variables are for: GITLAB_HOST, as a name or a URL, or gitlab.com.
function glabEnvHost(env: NodeJS.ProcessEnv): string {
  const value = GLAB_HOSTS.map((name) => env[name]?.trim()).find(Boolean)
  if (!value) {
    return 'gitlab.com'
  }
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase()
  } catch {
    return ''
  }
}

// Only whether a token variable is set is read, never its value.
export function glabEnvToken(host: string, env: NodeJS.ProcessEnv): boolean {
  return GLAB_TOKENS.some((name) => !!env[name]) && glabEnvHost(env) === host.toLowerCase()
}

export function glabKnowsHost(
  host: string,
  options: {
    env?: NodeJS.ProcessEnv
    // The variables the CLI runs with, for its token variables.
    tokenEnv?: NodeJS.ProcessEnv
    home?: string
    readFile?: (file: string) => string
  } = {},
): boolean {
  if (glabEnvToken(host, options.tokenEnv ?? cliTokenEnv())) {
    return true
  }
  const file = glabConfigFile(options.env ?? hostConfigEnv(), options.home ?? homedir())
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
