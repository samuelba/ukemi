import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { readSecretJson, type SecretStore } from '../forge/secretStore'
import {
  createPkcePair,
  exchangeGitlabCode,
  GitlabOAuthError,
  gitlabAuthorizeUrl,
  gitlabClientId,
  refreshGitlabToken,
  revokeGitlabToken,
  sessionNeedsRefresh,
  type GitlabOAuthSession,
} from '../forge/gitlabOAuth'
import { errorMessage, type Logger } from '../util/logger'
import type { Disposable, Event } from './events'
import type { Settings } from './settings'
import type { Ui } from './ui'

const SIGN_IN_TIMEOUT_MS = 180_000
const REJECTED_REFRESH_RECHECK_MS = 2_000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

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

// Where GitLab sends the browser back after sign-in. The host decides how it receives that.
export interface OAuthRedirect extends Disposable {
  // Returns the redirect URI, and starts listening for it if the host needs to.
  prepare(): Promise<string>
  readonly onDidRedirect: Event<URLSearchParams>
}

function oauthKey(host: string): string {
  return `ukemi.gitlab.oauth.${host}`
}

export class GitlabAuth implements Disposable {
  private readonly pending = new Map<string, PendingSignIn>()
  private readonly refreshInFlight = new Map<string, Promise<string | null>>()
  private readonly subscription: Disposable

  constructor(
    private readonly secrets: SecretStore,
    private readonly logger: Logger,
    private readonly redirect: OAuthRedirect,
    private readonly ui: Ui,
    private readonly settings: Settings,
  ) {
    this.subscription = redirect.onDidRedirect((params) => this.handleRedirect(params))
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
    const clientId = gitlabClientId(host, this.settings.read().gitlabOAuthApplications)
    if (!clientId) {
      return null
    }
    this.cancelHost(host)
    const { verifier, challenge } = createPkcePair()
    const state = randomBytes(16).toString('base64url')
    const redirectUri = await this.redirect.prepare()
    const url = gitlabAuthorizeUrl({ host, clientId, redirectUri, state, challenge })
    const token = new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        this.logger.warn(`GitLab sign-in for ${host} timed out`)
        this.cancelState(state)
      }, SIGN_IN_TIMEOUT_MS)
      this.pending.set(state, { host, clientId, verifier, redirectUri, timer, resolve })
    })
    const opened = await this.ui.openExternal(url)
    if (!opened) {
      this.cancelState(state)
      return null
    }
    return token
  }

  async forget(host: string): Promise<void> {
    this.cancelHost(host)
    const session = await this.read(host)
    await this.secrets.delete(oauthKey(host))
    if (session) {
      try {
        await revokeGitlabToken(fetch, {
          host,
          clientId: session.clientId,
          token: session.refreshToken,
        })
      } catch (error: unknown) {
        this.logger.warn(`GitLab token revocation failed: ${errorMessage(error)}`)
      }
    }
  }

  dispose(): void {
    this.subscription.dispose()
    this.redirect.dispose()
    for (const state of [...this.pending.keys()]) {
      this.cancelState(state)
    }
  }

  private handleRedirect(params: URLSearchParams): void {
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
      if (error instanceof GitlabOAuthError && error.isRejected) {
        this.logger.warn(`GitLab rejected the token refresh for ${host}: ${error.message}`)
        return this.afterRejectedRefresh(host, session)
      }
      this.logger.warn(`GitLab token refresh failed: ${errorMessage(error)}`)
      return null
    }
  }

  // GitLab rejects a refresh token another window has already used. That window stores the new
  // session, possibly only after this rejection arrives, so the session is deleted only if it
  // still holds the rejected token after a wait.
  private async afterRejectedRefresh(
    host: string,
    rejected: GitlabOAuthSession,
  ): Promise<string | null> {
    const stored = await this.storedElsewhere(host, rejected)
    if (stored !== 'unchanged') {
      return stored
    }
    await sleep(REJECTED_REFRESH_RECHECK_MS)
    const later = await this.storedElsewhere(host, rejected)
    if (later !== 'unchanged') {
      return later
    }
    this.logger.warn(`GitLab signed out of ${host}`)
    await this.secrets.delete(oauthKey(host))
    return null
  }

  // The access token another window stored, null when it signed out, or 'unchanged'.
  private async storedElsewhere(
    host: string,
    rejected: GitlabOAuthSession,
  ): Promise<string | null | 'unchanged'> {
    const current = await this.read(host)
    if (!current) {
      return null
    }
    if (current.refreshToken === rejected.refreshToken) {
      return 'unchanged'
    }
    this.logger.info(`GitLab: using the session another window refreshed for ${host}`)
    return current.accessToken
  }

  private read(host: string): Promise<GitlabOAuthSession | null> {
    return readSecretJson(this.secrets, oauthKey(host), sessionSchema)
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
