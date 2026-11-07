import { unknownHosts } from '../forge/detect'
import { isSafeHttpsHost } from '../forge/hostName'
import type { RepoModel } from '../repo/repoModel'
import type { CommandEnv } from './commands/context'
import { readHostLists, type Settings } from './settings'

const UNKNOWN_HOST_DETAIL =
  'Ukemi reads the remotes from jj. It recognises github.com, gitlab.com, gitlab.* hosts and the hosts that gh or glab are signed in to. For a self-hosted server, tell Ukemi its type. Ukemi stores it in ukemi.gitlab.hosts or ukemi.github.hosts.'

const NO_REMOTE_DETAIL = 'Add one with: jj git remote add origin <url>'

const GITLAB_CHOICE = 'It is GitLab'
const GITHUB_CHOICE = 'It is GitHub'
const SETTINGS_CHOICE = 'Open Settings'

type HostKind = 'gitlab' | 'github'

export async function showForgeMissing(model: RepoModel, env: CommandEnv): Promise<void> {
  const hosts = unknownHosts(await model.repo.remotes(), readHostLists(env.settings))
  const host = hosts[0]
  if (!host) {
    await env.ui.ask('warning', 'Ukemi: this repository has no GitHub or GitLab remote.', {
      detail: NO_REMOTE_DETAIL,
    })
    return
  }
  const choice = await env.ui.ask(
    'warning',
    `Ukemi does not know the server ${host}.`,
    { detail: unknownDetail(hosts) },
    GITLAB_CHOICE,
    GITHUB_CHOICE,
    SETTINGS_CHOICE,
  )
  if (choice === GITLAB_CHOICE || choice === GITHUB_CHOICE) {
    await rememberHost(choice === GITLAB_CHOICE ? 'gitlab' : 'github', host, model, env)
    return
  }
  if (choice === SETTINGS_CHOICE) {
    env.workbench.openSettings('ukemi.gitlab.hosts')
  }
}

function unknownDetail(hosts: readonly string[]): string {
  const others = hosts.slice(1)
  const extra = others.length > 0 ? ` Other unknown servers: ${others.join(', ')}.` : ''
  return `${UNKNOWN_HOST_DETAIL}${extra}`
}

async function rememberHost(
  kind: HostKind,
  host: string,
  model: RepoModel,
  env: CommandEnv,
): Promise<void> {
  if (!isSafeHttpsHost(host)) {
    void env.ui.warn(`Ukemi: ${host} is not a valid server name. Add it in Settings.`)
    return
  }
  await addHost(env.settings, kind, host)
  const client = await env.forge.signIn(model)
  if (!client) {
    void env.ui.warn('Ukemi: sign-in was cancelled.')
    return
  }
  await env.forge.refreshRequests(model, { force: true })
}

async function addHost(settings: Settings, kind: HostKind, host: string): Promise<void> {
  const config = settings.read()
  const current = kind === 'gitlab' ? config.gitlabHosts : config.githubHosts
  if (current.some((item) => item.toLowerCase() === host.toLowerCase())) {
    return
  }
  const key = kind === 'gitlab' ? 'gitlab.hosts' : 'github.hosts'
  await settings.update(key, [...current, host], 'user')
}
