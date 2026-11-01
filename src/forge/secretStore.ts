import type { z } from 'zod'

export interface SecretStore {
  get(key: string): PromiseLike<string | undefined>
  store(key: string, value: string): PromiseLike<void>
  delete(key: string): PromiseLike<void>
}

// A missing, unreadable, or outdated secret reads as null so the caller asks for a new one.
export async function readSecretJson<T>(
  secrets: SecretStore,
  key: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const raw = await secrets.get(key)
  if (!raw) {
    return null
  }
  try {
    const result = schema.safeParse(JSON.parse(raw))
    return result.success ? result.data : null
  } catch {
    return null
  }
}
