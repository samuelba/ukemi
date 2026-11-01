import type { SecretStore } from '../../forge/secretStore'
import { readJsonObject, withoutKey, writeJsonObject } from './jsonFile'

// The OS keychain, as Electron's safeStorage offers it.
export interface Encryptor {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

// Secrets are encrypted one by one with the OS keychain. Without a keychain nothing is stored,
// so a token never lands on disk in plain text.
export class SecretsFile implements SecretStore {
  private readonly session = new Map<string, string>()

  constructor(
    private readonly path: string,
    private readonly encryptor: Encryptor,
    private readonly onUnavailable: () => void = () => undefined,
  ) {}

  async get(key: string): Promise<string | undefined> {
    if (!this.encryptor.isEncryptionAvailable()) {
      return this.session.get(key)
    }
    const stored = readJsonObject(this.path)[key]
    if (typeof stored !== 'string') {
      return undefined
    }
    try {
      return this.encryptor.decryptString(Buffer.from(stored, 'base64'))
    } catch {
      return undefined
    }
  }

  async store(key: string, value: string): Promise<void> {
    if (!this.encryptor.isEncryptionAvailable()) {
      // Kept for this run only. The user is told once that sign-ins are not remembered.
      this.session.set(key, value)
      this.onUnavailable()
      return
    }
    const encrypted = this.encryptor.encryptString(value).toString('base64')
    writeJsonObject(this.path, { ...readJsonObject(this.path), [key]: encrypted })
  }

  async delete(key: string): Promise<void> {
    this.session.delete(key)
    const rest = withoutKey(readJsonObject(this.path), key)
    writeJsonObject(this.path, rest)
  }
}
