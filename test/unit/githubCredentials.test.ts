import { describe, expect, test } from 'vitest'
import {
  GithubCredentials,
  type CredentialUi,
  type GithubCredential,
  type SecretStore,
} from '../../src/forge/githubCredentials'

const HOST = 'github.com'
const TOKEN: GithubCredential = { username: 'sam', token: 'ghp_token' }
const SESSION: GithubCredential = { username: 'sam-session', token: 'gho_session' }

function setup(
  options: {
    stored?: string
    session?: GithubCredential | null
    choice?: 'session' | 'token'
    entered?: GithubCredential
  } = {},
) {
  const secrets = new Map<string, string>()
  if (options.stored !== undefined) {
    secrets.set(`ukemi.github.credential.${HOST}`, options.stored)
  }
  const store: SecretStore = {
    get: async (key) => secrets.get(key),
    store: async (key, value) => void secrets.set(key, value),
    delete: async (key) => void secrets.delete(key),
  }
  const asked: string[] = []
  const ui: CredentialUi = {
    choose: async (host) => {
      asked.push(`choose ${host}`)
      return options.choice
    },
    enterToken: async (host) => {
      asked.push(`token ${host}`)
      return options.entered
    },
  }
  const sessionCalls: boolean[] = []
  const sessions = async (_host: string, interactive: boolean) => {
    sessionCalls.push(interactive)
    return interactive ? SESSION : (options.session ?? null)
  }
  return { credentials: new GithubCredentials(store, sessions, ui), secrets, asked, sessionCalls }
}

describe('GithubCredentials', () => {
  test('uses a stored token without asking', async () => {
    const { credentials, asked } = setup({ stored: JSON.stringify(TOKEN) })

    expect(await credentials.get(HOST, 'ask-if-missing')).toEqual(TOKEN)
    expect(asked).toEqual([])
  })

  test('uses the editor session without asking when no token is stored', async () => {
    const { credentials, asked } = setup({ session: SESSION })

    expect(await credentials.get(HOST, 'ask-if-missing')).toEqual(SESSION)
    expect(asked).toEqual([])
  })

  test('returns nothing and does not ask in silent mode', async () => {
    const { credentials, asked, sessionCalls } = setup()

    expect(await credentials.get(HOST, 'silent')).toBeNull()
    expect(asked).toEqual([])
    expect(sessionCalls).toEqual([false])
  })

  test('stores an entered token and uses it next time', async () => {
    const { credentials, asked } = setup({ choice: 'token', entered: TOKEN })

    expect(await credentials.get(HOST, 'ask-if-missing')).toEqual(TOKEN)
    expect(await credentials.get(HOST, 'ask-if-missing')).toEqual(TOKEN)
    expect(asked).toEqual([`choose ${HOST}`, `token ${HOST}`])
  })

  test('signs in with the editor session when the user chooses it', async () => {
    const { credentials, sessionCalls } = setup({ choice: 'session' })

    expect(await credentials.get(HOST, 'ask-if-missing')).toEqual(SESSION)
    expect(sessionCalls).toEqual([false, true])
  })

  test('always asks when the user signs in on purpose, and drops the old token for a session', async () => {
    const { credentials, secrets, asked } = setup({
      stored: JSON.stringify(TOKEN),
      choice: 'session',
    })

    expect(await credentials.get(HOST, 'always-ask')).toEqual(SESSION)
    expect(asked).toEqual([`choose ${HOST}`])
    expect(secrets.size).toBe(0)
  })

  test('returns nothing and stores nothing when the user cancels', async () => {
    const { credentials, secrets } = setup({ choice: 'token' })

    expect(await credentials.get(HOST, 'ask-if-missing')).toBeNull()
    expect(secrets.size).toBe(0)
  })

  test('treats a damaged stored value as missing', async () => {
    const { credentials } = setup({ stored: '{not json', session: SESSION })

    expect(await credentials.get(HOST, 'silent')).toEqual(SESSION)
  })

  test('forgets a stored token and tells whether there was one', async () => {
    const { credentials, secrets } = setup({ stored: JSON.stringify(TOKEN) })

    expect(await credentials.forget(HOST)).toBe(true)
    expect(await credentials.forget(HOST)).toBe(false)
    expect(secrets.size).toBe(0)
  })
})
