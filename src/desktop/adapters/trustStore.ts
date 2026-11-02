import { resolve, sep } from 'node:path'
import type { KeyValueFile } from './keyValueFile'

const TRUSTED_KEY = 'trustedFolders'

// Folders the user trusts with stored forge credentials. A folder inside a trusted one is trusted.
export class TrustStore {
  constructor(private readonly store: KeyValueFile) {}

  isTrusted(folder: string): boolean {
    const path = resolve(folder)
    return this.folders().some((trusted) => path === trusted || path.startsWith(`${trusted}${sep}`))
  }

  async trust(folder: string): Promise<void> {
    const path = resolve(folder)
    if (!this.folders().includes(path)) {
      await this.store.update(TRUSTED_KEY, [...this.folders(), path])
    }
  }

  private folders(): string[] {
    const value = this.store.get<unknown>(TRUSTED_KEY)
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []
  }
}
