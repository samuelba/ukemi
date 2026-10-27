import * as vscode from 'vscode'
import type { ForgeState, RequestBadge } from '../../shared/protocol'
import type { CredentialRequest } from '../askpass/prompt'
import { detectForge, forgeKindForHost, type ForgeTarget } from '../forge/detect'
import { GithubClient } from '../forge/github'
import { GithubCredentials, type GithubCredential } from '../forge/githubCredentials'
import { glabFetch } from '../forge/glabApi'
import { glabKnowsHost } from '../forge/glabConfig'
import { GitlabClient, type GitlabTokenKind } from '../forge/gitlab'
import { FORGE_REFRESH_IDLE_MS, forgeRefreshInterval } from '../forge/refreshInterval'
import { ForgeError, type ForgeClient } from '../forge/types'
import type { RepoModel } from '../repo/repoModel'
import { parseDuration } from '../util/duration'
import { errorMessage, type Logger } from '../util/logger'
import { readConfig } from './config'
import { githubTokenUi } from './githubTokenUi'
import { GitlabAuth } from './gitlabAuth'
import type { RepoRegistry } from './registry'

const GITLAB_TOKEN_USER = 'oauth2'

type ForgeHost = Pick<ForgeTarget, 'kind' | 'host'>

type ForgeCredential = {
  token: string
  kind: 'github' | 'oauth' | GitlabTokenKind | 'glab'
}

function patKey(host: string): string {
  return `ukemi.gitlab.token.${host}`
}

function glabIgnoredKey(host: string): string {
  return `ukemi.gitlab.glabIgnored.${host}`
}

async function githubSession(host: string, interactive: boolean): Promise<GithubCredential | null> {
  const provider = host === 'github.com' ? 'github' : 'github-enterprise'
  const session = await vscode.authentication.getSession(provider, ['repo'], {
    createIfNone: interactive,
    silent: !interactive,
  })
  return session ? { username: session.account.label, token: session.accessToken } : null
}

function makeClient(target: ForgeTarget, credential: ForgeCredential): ForgeClient {
  if (target.kind === 'github') {
    return new GithubClient(target.host, target.projectPath, credential.token)
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

export class ForgeService implements vscode.Disposable {
  private readonly lastRefresh = new Map<string, number>()
  private readonly reportedMissing = new Set<string>()
  private readonly disposables: vscode.Disposable[] = []
  private readonly github: GithubCredentials
  private readonly gitlabAuth: GitlabAuth
  private timer: ReturnType<typeof setTimeout> | null = null
  private refreshing = false
  private disposed = false
  private warnedInterval: string | null = null

  constructor(
    private readonly registry: RepoRegistry,
    private readonly secrets: vscode.SecretStorage,
    private readonly logger: Logger,
    extensionId: string,
  ) {
    this.github = new GithubCredentials(secrets, githubSession, githubTokenUi)
    this.gitlabAuth = new GitlabAuth(secrets, logger, extensionId)
    this.disposables.push(
      this.gitlabAuth,
      registry.onDidChangeModel((model) => {
        if (model === registry.activeModel) {
          void this.refreshRequests(model)
        }
      }),
      vscode.window.onDidChangeWindowState((state) => {
        const model = this.registry.activeModel
        if (state.focused && model) {
          void this.refreshRequests(model)
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('ukemi.forge.statusInterval')) {
          return
        }
        const model = this.registry.activeModel
        if (model) {
          this.schedule(model)
        }
      }),
    )
  }

  async target(model: RepoModel): Promise<ForgeTarget | null> {
    return detectForge(await model.repo.remotes(), readConfig())
  }

  private async credential(
    target: ForgeHost,
    interactive: boolean,
  ): Promise<ForgeCredential | null> {
    if (target.kind === 'github') {
      const githubCredential = await this.github.get(
        target.host,
        interactive ? 'ask-if-missing' : 'silent',
      )
      return githubCredential ? { token: githubCredential.token, kind: 'github' } : null
    }
    const oauth = await this.gitlabAuth.accessToken(target.host)
    if (oauth) {
      return { token: oauth, kind: 'oauth' }
    }
    const pat = await this.secrets.get(patKey(target.host))
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

  private async glabCredential(host: string): Promise<boolean> {
    if ((await this.secrets.get(glabIgnoredKey(host))) === '1') {
      return false
    }
    return glabKnowsHost(host)
  }

  private async promptGitlabToken(host: string): Promise<string | null> {
    const tokenPage = `https://${host}/-/user_settings/personal_access_tokens?name=Ukemi&scopes=api`
    const choice = await vscode.window.showInformationMessage(
      `Ukemi needs a GitLab personal access token with the "api" scope for ${host}.`,
      'Create Token',
      'Enter Token',
    )
    if (choice === 'Create Token') {
      await vscode.env.openExternal(vscode.Uri.parse(tokenPage))
    } else if (choice !== 'Enter Token') {
      return null
    }
    const token = await vscode.window.showInputBox({
      title: `GitLab token for ${host}`,
      password: true,
      ignoreFocusOut: true,
      prompt: 'Paste a personal access token with the "api" scope',
    })
    if (!token) {
      return null
    }
    await this.secrets.store(patKey(host), token.trim())
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
    const kind = forgeKindForHost(request.host, readConfig())
    if (kind === 'github') {
      const mode = request.interactive ? 'ask-if-missing' : 'silent'
      const credential = await this.github.get(request.host, mode)
      if (!credential) {
        return null
      }
      return request.field === 'username' ? credential.username : credential.token
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
    if (target.kind === 'github') {
      const credential = await this.github.get(target.host, 'always-ask')
      return credential ? makeClient(target, { token: credential.token, kind: 'github' }) : null
    }
    await this.secrets.delete(glabIgnoredKey(target.host))
    return this.client(model, true)
  }

  async signOut(model: RepoModel): Promise<void> {
    const target = await this.target(model)
    if (target?.kind === 'gitlab') {
      await this.secrets.delete(patKey(target.host))
      await this.gitlabAuth.forget(target.host)
      await this.secrets.store(glabIgnoredKey(target.host), '1')
    }
    if (target?.kind === 'github' && !(await this.github.forget(target.host))) {
      void vscode.window.showInformationMessage(
        'Ukemi uses the GitHub account of the editor. Sign out of it in the Accounts menu.',
      )
    }
    model.setForge(target ? { kind: target.kind, host: target.host, isSignedIn: false } : null, [])
  }

  async refreshRequests(model: RepoModel, options: { force?: boolean } = {}): Promise<void> {
    if (this.disposed || this.refreshing) {
      return
    }
    if (!options.force && !vscode.window.state.focused) {
      return
    }
    const interval = this.refreshInterval(model)
    const last = this.lastRefresh.get(model.root) ?? 0
    if (!options.force && Date.now() - last < interval) {
      this.schedule(model)
      return
    }
    this.refreshing = true
    this.lastRefresh.set(model.root, Date.now())
    try {
      await this.loadRequests(model)
    } catch (error: unknown) {
      const isAuth = error instanceof ForgeError && error.isAuthError
      this.logger.warn(`loading requests failed: ${errorMessage(error)}`)
      if (isAuth) {
        void vscode.window.showWarningMessage('Ukemi: the forge login has expired. Sign in again.')
      }
    } finally {
      this.refreshing = false
      this.schedule(model)
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    for (const disposable of this.disposables) {
      disposable.dispose()
    }
  }

  private schedule(model: RepoModel): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.disposed || !vscode.window.state.focused || this.registry.activeModel !== model) {
      return
    }
    const interval = this.refreshInterval(model)
    const last = this.lastRefresh.get(model.root) ?? 0
    const delay = Math.max(0, interval - (Date.now() - last))
    this.timer = setTimeout(() => {
      this.timer = null
      const active = this.registry.activeModel
      if (active) {
        void this.refreshRequests(active)
      }
    }, delay)
  }

  private refreshInterval(model: RepoModel): number {
    return forgeRefreshInterval(requestsOf(model), this.idleIntervalMs())
  }

  private idleIntervalMs(): number {
    const text = readConfig().statusInterval
    const parsed = parseDuration(text)
    if (parsed !== null) {
      this.warnedInterval = null
      return parsed
    }
    if (this.warnedInterval !== text) {
      this.warnedInterval = text
      this.logger.warn(`status interval "${text.slice(0, 40)}" is not valid, using 60s`)
    }
    return FORGE_REFRESH_IDLE_MS
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
      await this.fetchRequests(target, credential, branchNames(model), readConfig().requestLimit),
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
