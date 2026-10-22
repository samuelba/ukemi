import * as vscode from 'vscode'
import type { ForgeState } from '../../shared/protocol'
import { detectForge, type ForgeTarget } from '../forge/detect'
import { GithubClient } from '../forge/github'
import { GitlabClient } from '../forge/gitlab'
import { ForgeError, type ForgeClient } from '../forge/types'
import type { RepoModel } from '../repo/repoModel'
import { errorMessage, type Logger } from '../util/logger'
import { readConfig } from './config'
import type { RepoRegistry } from './registry'

const REQUEST_REFRESH_INTERVAL_MS = 60_000
const GITHUB_SCOPES = ['repo']

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

  private async token(target: ForgeTarget, interactive: boolean): Promise<string | null> {
    if (target.kind === 'github') {
      const provider = target.host === 'github.com' ? 'github' : 'github-enterprise'
      const session = await vscode.authentication.getSession(provider, GITHUB_SCOPES, {
        createIfNone: interactive,
        silent: !interactive,
      })
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
