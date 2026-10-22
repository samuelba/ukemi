import * as vscode from 'vscode'
import type { ForgeState } from '../../shared/protocol'
import type { CredentialRequest } from '../askpass/prompt'
import { detectForge, forgeKindForHost, type ForgeTarget } from '../forge/detect'
import { GithubClient } from '../forge/github'
import { GitlabClient } from '../forge/gitlab'
import { ForgeError, type ForgeClient } from '../forge/types'
import type { RepoModel } from '../repo/repoModel'
import { errorMessage, type Logger } from '../util/logger'
import { readConfig } from './config'
import type { RepoRegistry } from './registry'

const REQUEST_REFRESH_INTERVAL_MS = 60_000
const GITHUB_SCOPES = ['repo']
const GITLAB_TOKEN_USER = 'oauth2'

type ForgeHost = Pick<ForgeTarget, 'kind' | 'host'>

function secretKey(host: string): string {
  return `ukemi.gitlab.token.${host}`
}

function makeClient(target: ForgeTarget, token: string): ForgeClient {
  return target.kind === 'github'
    ? new GithubClient(target.host, target.projectPath, token)
    : new GitlabClient(target.host, target.projectPath, token)
}

export class ForgeService implements vscode.Disposable {
  private readonly lastRefresh = new Map<string, number>()
  private readonly subscription: vscode.Disposable

  constructor(
    private readonly registry: RepoRegistry,
    private readonly secrets: vscode.SecretStorage,
    private readonly logger: Logger,
  ) {
    this.subscription = registry.onDidChangeModel((model) => {
      if (model === registry.activeModel) {
        void this.refreshRequests(model)
      }
    })
  }

  async target(model: RepoModel): Promise<ForgeTarget | null> {
    const config = readConfig()
    return detectForge(await model.repo.remotes(), config)
  }

  private githubSession(host: string, interactive: boolean) {
    const provider = host === 'github.com' ? 'github' : 'github-enterprise'
    return vscode.authentication.getSession(provider, GITHUB_SCOPES, {
      createIfNone: interactive,
      silent: !interactive,
    })
  }

  private async token(target: ForgeHost, interactive: boolean): Promise<string | null> {
    if (target.kind === 'github') {
      const session = await this.githubSession(target.host, interactive)
      return session?.accessToken ?? null
    }
    const stored = await this.secrets.get(secretKey(target.host))
    if (stored || !interactive) {
      return stored ?? null
    }
    return this.promptGitlabToken(target.host)
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
    await this.secrets.store(secretKey(host), token.trim())
    return token.trim()
  }

  async client(model: RepoModel, interactive: boolean): Promise<ForgeClient | null> {
    const target = await this.target(model)
    if (!target) {
      return null
    }
    const token = await this.token(target, interactive)
    return token ? makeClient(target, token) : null
  }

  async gitCredential(request: CredentialRequest): Promise<string | null> {
    const kind = forgeKindForHost(request.host, readConfig())
    if (kind === 'github') {
      const session = await this.githubSession(request.host, true)
      if (!session) {
        return null
      }
      return request.field === 'username' ? session.account.label : session.accessToken
    }
    if (kind === 'gitlab') {
      const token = await this.token({ kind, host: request.host }, true)
      if (!token) {
        return null
      }
      return request.field === 'username' ? GITLAB_TOKEN_USER : token
    }
    return null
  }

  async signOut(model: RepoModel): Promise<void> {
    const target = await this.target(model)
    if (target?.kind === 'gitlab') {
      await this.secrets.delete(secretKey(target.host))
    }
    model.setForge(target ? { kind: target.kind, host: target.host, isSignedIn: false } : null, [])
  }

  async refreshRequests(model: RepoModel, options: { force?: boolean } = {}): Promise<void> {
    const now = Date.now()
    const last = this.lastRefresh.get(model.root) ?? 0
    if (!options.force && now - last < REQUEST_REFRESH_INTERVAL_MS) {
      return
    }
    this.lastRefresh.set(model.root, now)
    try {
      const target = await this.target(model)
      if (!target) {
        model.setForge(null, [])
        return
      }
      const token = await this.token(target, false)
      const state: ForgeState = { kind: target.kind, host: target.host, isSignedIn: token !== null }
      if (!token) {
        model.setForge(state, [])
        return
      }
      const client = makeClient(target, token)
      const branches = [
        ...new Set(
          (model.graph?.commits ?? []).flatMap((c) => [
            ...c.localBookmarks.map((b) => b.name),
            ...c.remoteBookmarks.map((b) => b.name),
          ]),
        ),
      ]
      model.setForge(state, await client.listRequests(branches))
    } catch (error: unknown) {
      const isAuth = error instanceof ForgeError && error.isAuthError
      this.logger.warn(`loading requests failed: ${errorMessage(error)}`)
      if (isAuth) {
        void vscode.window.showWarningMessage('Ukemi: the forge login has expired. Sign in again.')
      }
    }
  }

  dispose(): void {
    this.subscription.dispose()
  }
}
