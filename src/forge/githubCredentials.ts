import { z } from 'zod'

export interface GithubCredential {
  username: string
  token: string
}

export interface SecretStore {
  get(key: string): PromiseLike<string | undefined>
  store(key: string, value: string): PromiseLike<void>
  delete(key: string): PromiseLike<void>
}

export interface CredentialUi {
  choose(host: string): Promise<'session' | 'token' | undefined>
  enterToken(host: string): Promise<GithubCredential | undefined>
}

export type SessionSource = (host: string, interactive: boolean) => Promise<GithubCredential | null>

export type CredentialMode = 'silent' | 'ask-if-missing' | 'always-ask'

const storedSchema = z.object({ username: z.string().min(1), token: z.string().min(1) })

function secretKey(host: string): string {
  return `ukemi.github.credential.${host}`
}

export class GithubCredentials {
  constructor(
    private readonly secrets: SecretStore,
    private readonly sessions: SessionSource,
    private readonly ui: CredentialUi,
  ) {}

  async get(host: string, mode: CredentialMode): Promise<GithubCredential | null> {
    if (mode !== 'always-ask') {
      const known = (await this.stored(host)) ?? (await this.sessions(host, false))
      if (known || mode === 'silent') {
        return known
      }
    }
    const choice = await this.ui.choose(host)
    if (choice === 'session') {
      const session = await this.sessions(host, true)
      if (session) {
        await this.secrets.delete(secretKey(host))
      }
      return session
    }
    if (choice === 'token') {
      const entered = await this.ui.enterToken(host)
      if (entered) {
        await this.secrets.store(secretKey(host), JSON.stringify(entered))
        return entered
      }
    }
    return null
  }

  async forget(host: string): Promise<boolean> {
    const hadToken = (await this.secrets.get(secretKey(host))) !== undefined
    await this.secrets.delete(secretKey(host))
    return hadToken
  }

  private async stored(host: string): Promise<GithubCredential | null> {
    const raw = await this.secrets.get(secretKey(host))
    if (!raw) {
      return null
    }
    try {
      const result = storedSchema.safeParse(JSON.parse(raw))
      return result.success ? result.data : null
    } catch {
      return null
    }
  }
}
