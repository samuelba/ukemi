import { randomBytes } from 'node:crypto'
import * as vscode from 'vscode'
import { z } from 'zod'
import type { SecretStore } from '../forge/githubCredentials'
import {
  createPkcePair,
  exchangeGitlabCode,
  GitlabOAuthError,
  gitlabAuthorizeUrl,
  gitlabClientId,
  refreshGitlabToken,
  sessionNeedsRefresh,
  type GitlabOAuthSession,
} from '../forge/gitlabOAuth'
import { errorMessage, type Logger } from '../util/logger'
import { readConfig } from './config'

const SIGN_IN_TIMEOUT_MS = 180_000

const sessionSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number(),
  clientId: z.string().min(1),
})

interface PendingSignIn {
  host: string
  clientId: string
  verifier: string
  redirectUri: string
  timer: ReturnType<typeof setTimeout>
  resolve: (token: string | null) => void
}

function oauthKey(host: string): string {
  return `ukemi.gitlab.oauth.${host}`
}

function isAuthPath(path: string): boolean {
  return path === '/gitlab-auth' || path === 'gitlab-auth'
}

export class GitlabAuth implements vscode.Disposable {
  private readonly pending = new Map<string, PendingSignIn>()
  private readonly refreshInFlight = new Map<string, Promise<string | null>>()
  private readonly subscription: vscode.Disposable

  constructor(
    private readonly secrets: SecretStore,
    private readonly logger: Logger,
    private readonly extensionId: string,
  ) {
    this.subscription = vscode.window.registerUriHandler({
      handleUri: (uri) => this.handleUri(uri),
    })
  }

  async accessToken(host: string): Promise<string | null> {
    const session = await this.read(host)
    if (!session) {
      return null
    }
    if (!sessionNeedsRefresh(session, Date.now())) {
      return session.accessToken
    }
    return this.refresh(host, session)
  }

  async forceRefresh(host: string): Promise<string | null> {
    const session = await this.read(host)
    if (!session) {
      return null
    }
    return this.refresh(host, session)
  }

  async signIn(host: string): Promise<string | null> {
    const clientId = gitlabClientId(host, readConfig().gitlabOAuthApplications)
    if (!clientId) {
      return null
    }
    this.cancelHost(host)
    const { verifier, challenge } = createPkcePair()
    const state = randomBytes(16).toString('base64url')
    const redirectUri = `${vscode.env.uriScheme}://${this.extensionId}/gitlab-auth`
    const url = gitlabAuthorizeUrl({ host, clientId, redirectUri, state, challenge })
    const token = new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        this.logger.warn(`GitLab sign-in for ${host} timed out`)
        this.cancelState(state)
      }, SIGN_IN_TIMEOUT_MS)
      this.pending.set(state, { host, clientId, verifier, redirectUri, timer, resolve })
    })
    const opened = await vscode.env.openExternal(vscode.Uri.parse(url))
    if (!opened) {
      this.cancelState(state)
      return null
    }
    return token
  }

  async forget(host: string): Promise<void> {
    this.cancelHost(host)
    await this.secrets.delete(oauthKey(host))
  }

  dispose(): void {
    this.subscription.dispose()
    for (const state of [...this.pending.keys()]) {
      this.cancelState(state)
    }
  }

  private handleUri(uri: vscode.Uri): void {
    if (!isAuthPath(uri.path)) {
      return
    }
    const params = new URLSearchParams(uri.query)
    const state = params.get('state')
    if (!state) {
      return
    }
    const pending = this.pending.get(state)
    if (!pending) {
      return
    }
    clearTimeout(pending.timer)
    this.pending.delete(state)
    const code = params.get('code')
    if (params.get('error') || !code) {
      pending.resolve(null)
      return
    }
    void this.finish(pending, code)
  }

  private async finish(pending: PendingSignIn, code: string): Promise<void> {
    try {
      const session = await exchangeGitlabCode(fetch, {
        host: pending.host,
        clientId: pending.clientId,
        code,
        redirectUri: pending.redirectUri,
        verifier: pending.verifier,
      })
      await this.store(pending.host, session)
      pending.resolve(session.accessToken)
    } catch (error: unknown) {
      this.logger.warn(`GitLab sign-in failed: ${errorMessage(error)}`)
      pending.resolve(null)
    }
  }

  private refresh(host: string, session: GitlabOAuthSession): Promise<string | null> {
    const existing = this.refreshInFlight.get(host)
    if (existing) {
      return existing
    }
    const pending = this.refreshNow(host, session).finally(() => this.refreshInFlight.delete(host))
    this.refreshInFlight.set(host, pending)
    return pending
  }

  private async refreshNow(host: string, session: GitlabOAuthSession): Promise<string | null> {
    try {
      const next = await refreshGitlabToken(fetch, {
        host,
        clientId: session.clientId,
        refreshToken: session.refreshToken,
      })
      await this.store(host, next)
      return next.accessToken
    } catch (error: unknown) {
      this.logger.warn(`GitLab token refresh failed: ${errorMessage(error)}`)
      if (error instanceof GitlabOAuthError && error.isRejected) {
        await this.secrets.delete(oauthKey(host))
      }
      return null
    }
  }

  private async read(host: string): Promise<GitlabOAuthSession | null> {
    const raw = await this.secrets.get(oauthKey(host))
    if (!raw) {
      return null
    }
    try {
      const parsed = sessionSchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  private async store(host: string, session: GitlabOAuthSession): Promise<void> {
    await this.secrets.store(oauthKey(host), JSON.stringify(session))
  }

  private cancelHost(host: string): void {
    for (const [state, pending] of this.pending) {
      if (pending.host === host) {
        this.cancelState(state)
      }
    }
  }

  private cancelState(state: string): void {
    const pending = this.pending.get(state)
    if (!pending) {
      return
    }
    clearTimeout(pending.timer)
    this.pending.delete(state)
    pending.resolve(null)
  }
}
