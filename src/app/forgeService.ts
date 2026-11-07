import type { ForgeState, RequestBadge } from '../../shared/protocol'
import type { CredentialRequest } from '../askpass/prompt'
import { detectForge, forgeKindForHost, type ForgeTarget } from '../forge/detect'
import { cliAvailable, type CliBinary } from '../forge/cli'
import { ghGitCredential, ghFetch } from '../forge/ghApi'
import { ghKnowsHost } from '../forge/ghConfig'
import { GithubClient } from '../forge/github'
import {
  GithubCredentials,
  type GithubCredential,
  type SessionSource,
} from '../forge/githubCredentials'
import { glabFetch } from '../forge/glabApi'
import { glabKnowsHost } from '../forge/glabConfig'
import { GitlabClient, type GitlabTokenKind } from '../forge/gitlab'
import {
  FORGE_REFRESH_IDLE_MS,
  forgeRefreshInterval,
  rateLimitPause,
} from '../forge/refreshInterval'
import { ForgeError, type ForgeClient } from '../forge/types'
import type { RepoModel } from '../repo/repoModel'
import { durationSetting } from '../util/duration'
import { errorMessage, type Logger } from '../util/logger'
import { disposeAll, type Disposable } from './events'
import { githubTokenUi } from './githubTokenUi'
import { GitlabAuth, type OAuthRedirect } from './gitlabAuth'
import type { Host } from './host'
import type { RepoRegistry } from './registry'
import { readHostLists } from './settings'

const GITLAB_TOKEN_USER = 'oauth2'

type ForgeHost = Pick<ForgeTarget, 'kind' | 'host'>

type ForgeCredential = {
  token: string
  kind: 'github' | 'gh' | 'oauth' | GitlabTokenKind | 'glab'
}

function patKey(host: string): string {
  return `ukemi.gitlab.token.${host}`
}

function glabIgnoredKey(host: string): string {
  return `ukemi.gitlab.glabIgnored.${host}`
}

function ghIgnoredKey(host: string): string {
  return `ukemi.github.ghIgnored.${host}`
}

type GithubSource = { kind: 'stored'; credential: GithubCredential } | { kind: 'gh' }

// The sign-in that only one host offers.
export interface ForgeAccounts {
  // The editor's own GitHub account. Null where the host has none.
  githubSession: SessionSource | null
  gitlabRedirect: OAuthRedirect
  // Explains how to trust the repository when it is untrusted.
  untrustedMessage: string
}

type ForgeHostPorts = Pick<Host, 'ui' | 'settings' | 'window' | 'secrets'>

const NO_SESSION: SessionSource = async () => null

function makeClient(target: ForgeTarget, credential: ForgeCredential): ForgeClient {
  if (target.kind === 'github') {
    return credential.kind === 'gh'
      ? new GithubClient(target.host, target.projectPath, '', ghFetch(target.host))
      : new GithubClient(target.host, target.projectPath, credential.token)
  }
  if (credential.kind === 'glab') {
    return new GitlabClient(target.host, target.projectPath, '', glabFetch(target.host), 'pat')
  }
  const tokenKind: GitlabTokenKind = credential.kind === 'oauth' ? 'oauth' : 'pat'
  return new GitlabClient(target.host, target.projectPath, credential.token, fetch, tokenKind)
}

function branchNames(model: RepoModel): string[] {
  return [
    ...new Set(
      (model.graph?.commits ?? []).flatMap((commit) => [
        ...commit.localBookmarks.map((bookmark) => bookmark.name),
        ...commit.remoteBookmarks.map((bookmark) => bookmark.name),
      ]),
    ),
  ]
}

function requestsOf(model: RepoModel): RequestBadge[] {
  return model.graph?.commits.flatMap((commit) => commit.requests) ?? []
}

function refreshError(error: unknown): string {
  if (error instanceof ForgeError && error.isRateLimited) {
    return "the forge's rate limit is used up"
  }
  if (error instanceof ForgeError && error.isAuthError) {
    return 'the forge login has expired'
  }
  return errorMessage(error)
}

export class ForgeService implements Disposable {
  private readonly lastRefresh = new Map<string, number>()
  // Per repository: until when background refreshes wait for the rate limit, and how many
  // refreshes in a row it refused.
  private readonly rateLimit = new Map<string, { until: number; refusals: number }>()
  private readonly reportedMissing = new Set<string>()
  private readonly reportedErrors = new Set<string>()
  private readonly disposables: Disposable[] = []
  private readonly github: GithubCredentials
  private readonly gitlabAuth: GitlabAuth
  private timer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<void> | null = null
  private disposed = false
  private readonly readIdleInterval: (text: string) => number

  constructor(
    private readonly registry: RepoRegistry,
    private readonly host: ForgeHostPorts,
    private readonly logger: Logger,
    private readonly accounts: ForgeAccounts,
  ) {
    this.github = new GithubCredentials(
      host.secrets,
      accounts.githubSession ?? NO_SESSION,
      githubTokenUi(host.ui, accounts.githubSession !== null),
    )
    this.gitlabAuth = new GitlabAuth(
      host.secrets,
      logger,
      accounts.gitlabRedirect,
      host.ui,
      host.settings,
    )
    this.readIdleInterval = durationSetting(
      'status interval',
      FORGE_REFRESH_IDLE_MS,
      '60s',
      (message) => logger.warn(message),
    )
    this.disposables.push(
      this.gitlabAuth,
      registry.onDidChangeModel((model) => {
        if (model === registry.activeModel) {
          void this.refreshRequests(model)
        }
      }),
      host.window.onDidFocus(() => {
        const model = this.registry.activeModel
        if (model) {
          void this.refreshRequests(model)
        }
      }),
      host.window.onDidGrantTrust(() => {
        const model = this.registry.activeModel
        if (model) {
          void this.refreshRequests(model, { force: true })
        }
      }),
      host.settings.onDidChange((change) => {
        const model = this.registry.activeModel
        if (model && change.affects('forge.statusInterval', model.root)) {
          this.schedule(model)
        }
      }),
    )
  }

  async target(model: RepoModel): Promise<ForgeTarget | null> {
    const remotes = model.remotes ?? (await model.repo.remotes())
    return detectForge(remotes, readHostLists(this.host.settings))
  }

  private isTrusted(announce: boolean): boolean {
    const trusted = this.host.window.isTrusted
    if (!trusted && announce) {
      void this.host.ui.warn(this.accounts.untrustedMessage)
    }
    return trusted
  }

  private async credential(
    target: ForgeHost,
    interactive: boolean,
  ): Promise<ForgeCredential | null> {
    if (!this.isTrusted(interactive)) {
      return null
    }
    if (target.kind === 'github') {
      const source = await this.githubSource(target.host, interactive)
      if (!source) {
        return null
      }
      return source.kind === 'gh'
        ? { token: '', kind: 'gh' }
        : { token: source.credential.token, kind: 'github' }
    }
    const oauth = await this.gitlabAuth.accessToken(target.host)
    if (oauth) {
      return { token: oauth, kind: 'oauth' }
    }
    const pat = await this.host.secrets.get(patKey(target.host))
    if (pat) {
      return { token: pat, kind: 'pat' }
    }
    if (await this.glabCredential(target.host)) {
      return { token: '', kind: 'glab' }
    }
    if (!interactive) {
      return null
    }
    const signedIn = await this.gitlabAuth.signIn(target.host)
    if (signedIn) {
      return { token: signedIn, kind: 'oauth' }
    }
    const prompted = await this.promptGitlabToken(target.host)
    return prompted ? { token: prompted, kind: 'pat' } : null
  }

  // Order: stored token, editor account, `gh`, then a prompt when interactive.
  private async githubSource(host: string, interactive: boolean): Promise<GithubSource | null> {
    const known = await this.github.get(host, 'silent')
    if (known) {
      return { kind: 'stored', credential: known }
    }
    if (await this.ghCredential(host)) {
      return { kind: 'gh' }
    }
    if (!interactive) {
      return null
    }
    const asked = await this.github.get(host, 'ask-if-missing')
    return asked ? { kind: 'stored', credential: asked } : null
  }

  private ghCredential(host: string): Promise<boolean> {
    return this.cliCredential(ghIgnoredKey(host), 'gh', () => ghKnowsHost(host))
  }

  private glabCredential(host: string): Promise<boolean> {
    return this.cliCredential(glabIgnoredKey(host), 'glab', () => glabKnowsHost(host))
  }

  // A CLI login counts unless the user signed out of it for this host.
  private async cliCredential(
    ignoredKey: string,
    binary: CliBinary,
    knowsHost: () => boolean,
  ): Promise<boolean> {
    if ((await this.host.secrets.get(ignoredKey)) === '1') {
      return false
    }
    return knowsHost() && (await cliAvailable(binary))
  }

  private async promptGitlabToken(host: string): Promise<string | null> {
    const tokenPage = `https://${host}/-/user_settings/personal_access_tokens?name=Ukemi&scopes=api`
    const choice = await this.host.ui.info(
      `Ukemi needs a GitLab personal access token with the "api" scope for ${host}.`,
      'Create Token',
      'Enter Token',
    )
    if (choice === 'Create Token') {
      await this.host.ui.openExternal(tokenPage)
    } else if (choice !== 'Enter Token') {
      return null
    }
    const token = await this.host.ui.input({
      title: `GitLab token for ${host}`,
      password: true,
      prompt: 'Paste a personal access token with the "api" scope',
    })
    if (!token) {
      return null
    }
    await this.host.secrets.store(patKey(host), token.trim())
    return token.trim()
  }

  async client(model: RepoModel, interactive: boolean): Promise<ForgeClient | null> {
    const target = await this.target(model)
    if (!target) {
      return null
    }
    const credential = await this.credential(target, interactive)
    return credential ? makeClient(target, credential) : null
  }

  async gitCredential(request: CredentialRequest): Promise<string | null> {
    if (!this.isTrusted(false)) {
      return null
    }
    const kind = forgeKindForHost(request.host, readHostLists(this.host.settings))
    if (kind === 'github') {
      const source = await this.githubSource(request.host, request.interactive)
      if (!source) {
        return null
      }
      if (source.kind === 'gh') {
        return ghGitCredential(request.host, request.field)
      }
      return request.field === 'username' ? source.credential.username : source.credential.token
    }
    if (kind === 'gitlab') {
      const credential = await this.credential({ kind, host: request.host }, request.interactive)
      if (!credential || credential.kind === 'glab') {
        return null
      }
      return request.field === 'username' ? GITLAB_TOKEN_USER : credential.token
    }
    return null
  }

  async signIn(model: RepoModel): Promise<ForgeClient | null> {
    const target = await this.target(model)
    if (!target) {
      return null
    }
    if (!this.isTrusted(true)) {
      return null
    }
    if (target.kind === 'github') {
      await this.host.secrets.delete(ghIgnoredKey(target.host))
      if (
        !(await this.github.get(target.host, 'silent')) &&
        (await this.ghCredential(target.host))
      ) {
        return makeClient(target, { token: '', kind: 'gh' })
      }
      const credential = await this.github.get(target.host, 'always-ask')
      return credential ? makeClient(target, { token: credential.token, kind: 'github' }) : null
    }
    await this.host.secrets.delete(glabIgnoredKey(target.host))
    return this.client(model, true)
  }

  async signOut(model: RepoModel): Promise<void> {
    const target = await this.target(model)
    if (target?.kind === 'gitlab') {
      await this.host.secrets.delete(patKey(target.host))
      await this.gitlabAuth.forget(target.host)
      await this.host.secrets.store(glabIgnoredKey(target.host), '1')
    }
    if (target?.kind === 'github') {
      await this.host.secrets.store(ghIgnoredKey(target.host), '1')
    }
    if (target?.kind === 'github' && !(await this.github.forget(target.host))) {
      void this.host.ui.info(
        this.accounts.githubSession
          ? 'Ukemi stopped using the GitHub CLI for this host. It may still use the GitHub account of the editor; sign out of it in the Accounts menu.'
          : 'Ukemi stopped using the GitHub CLI for this host.',
      )
    }
    model.setForge(target ? { kind: target.kind, host: target.host, isSignedIn: false } : null, [])
  }

  async refreshRequests(model: RepoModel, options: { force?: boolean } = {}): Promise<void> {
    if (this.disposed) {
      return
    }
    if (this.running) {
      // A forced refresh follows a create, merge or sync, and the running one may have read the
      // requests before it. So it runs again once that one ends, and the caller waits for it.
      if (options.force) {
        await this.running
        await this.refreshRequests(model, options)
      }
      return
    }
    if (!options.force && !this.host.window.isFocused) {
      return
    }
    const interval = this.refreshInterval(model)
    const last = this.lastRefresh.get(model.root) ?? 0
    const limitedUntil = this.rateLimit.get(model.root)?.until ?? 0
    if (!options.force && (Date.now() - last < interval || Date.now() < limitedUntil)) {
      this.schedule(model)
      return
    }
    this.lastRefresh.set(model.root, Date.now())
    this.running = this.loadReportingErrors(model).finally(() => {
      this.running = null
      this.schedule(model)
    })
    await this.running
  }

  private async loadReportingErrors(model: RepoModel): Promise<void> {
    try {
      await this.loadRequests(model)
      this.rateLimit.delete(model.root)
    } catch (error: unknown) {
      this.logger.warn(`loading requests failed: ${errorMessage(error)}`)
      model.markForgeStale(refreshError(error))
      if (error instanceof ForgeError && error.isRateLimited) {
        this.pauseForRateLimit(model, error)
      } else if (error instanceof ForgeError && error.isAuthError) {
        void this.host.ui.warn('Ukemi: the forge login has expired. Sign in again.')
      } else if (error instanceof ForgeError) {
        this.reportOnce(`Ukemi could not load the requests. ${error.message}`)
      }
    }
  }

  // The forge's answer does not change until the user does something, so it is shown once.
  private reportOnce(message: string): void {
    if (!this.reportedErrors.has(message)) {
      this.reportedErrors.add(message)
      void this.host.ui.warn(message)
    }
  }

  private pauseForRateLimit(model: RepoModel, error: ForgeError): void {
    const refusals = (this.rateLimit.get(model.root)?.refusals ?? 0) + 1
    const pause = rateLimitPause(error.retryAfterMs, refusals)
    this.rateLimit.set(model.root, { until: Date.now() + pause, refusals })
    if (refusals === 1) {
      const minutes = Math.ceil(pause / 60_000)
      void this.host.ui.warn(
        `Ukemi: the forge's rate limit is used up. Request status refreshes again in ${minutes} min.`,
      )
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    disposeAll(this.disposables)
  }

  private schedule(model: RepoModel): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.disposed || !this.host.window.isFocused || this.registry.activeModel !== model) {
      return
    }
    const interval = this.refreshInterval(model)
    const last = this.lastRefresh.get(model.root) ?? 0
    const limitedUntil = this.rateLimit.get(model.root)?.until ?? 0
    const delay = Math.max(0, interval - (Date.now() - last), limitedUntil - Date.now())
    this.timer = setTimeout(() => {
      this.timer = null
      const active = this.registry.activeModel
      if (active) {
        void this.refreshRequests(active)
      }
    }, delay)
  }

  private refreshInterval(model: RepoModel): number {
    return forgeRefreshInterval(requestsOf(model), this.idleIntervalMs(model))
  }

  private idleIntervalMs(model: RepoModel): number {
    return this.readIdleInterval(this.host.settings.read(model.root).statusInterval)
  }

  private async loadRequests(model: RepoModel): Promise<void> {
    const target = await this.target(model)
    if (!target) {
      model.setForge(null, [])
      return
    }
    const credential = await this.credential(target, false)
    const state: ForgeState = {
      kind: target.kind,
      host: target.host,
      isSignedIn: credential !== null,
    }
    if (!credential) {
      if (target.kind === 'gitlab') {
        this.reportMissing(target.host)
      }
      model.setForge(state, [])
      return
    }
    model.setForge(
      state,
      await this.fetchRequests(
        target,
        credential,
        branchNames(model),
        this.host.settings.read(model.root).requestLimit,
      ),
    )
  }

  private reportMissing(host: string): void {
    if (this.reportedMissing.has(host)) {
      return
    }
    this.reportedMissing.add(host)
    this.logger.info(`no GitLab credentials for ${host}`)
  }

  private async fetchRequests(
    target: ForgeTarget,
    credential: ForgeCredential,
    branches: readonly string[],
    limit: number,
  ): Promise<RequestBadge[]> {
    try {
      return await makeClient(target, credential).listRequests(branches, limit)
    } catch (error: unknown) {
      if (!(error instanceof ForgeError) || !error.isAuthError) {
        throw error
      }
      if (credential.kind === 'oauth') {
        const refreshed = await this.gitlabAuth.forceRefresh(target.host)
        if (!refreshed) {
          throw error
        }
        return makeClient(target, { token: refreshed, kind: 'oauth' }).listRequests(branches, limit)
      }
      throw error
    }
  }
}
