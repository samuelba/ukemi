import { beforeEach, describe, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  trusted: true,
  session: null as { account: { label: string }; accessToken: string } | null,
  ghHostsKnown: new Set<string>(),
  ghBinary: true,
  glabHostsKnown: new Set<string>(),
  glabBinary: true,
  ghGit: { username: 'gh-user', password: 'gh-token' },
  messages: [] as string[],
}))

vi.mock('vscode', () => ({
  workspace: {
    get isTrusted() {
      return state.trusted
    },
    getConfiguration: () => ({
      get: (_key: string, fallback: unknown) => fallback,
      inspect: () => undefined,
    }),
    onDidGrantWorkspaceTrust: () => ({ dispose: () => undefined }),
    onDidChangeConfiguration: () => ({ dispose: () => undefined }),
  },
  window: {
    state: { focused: true },
    registerUriHandler: () => ({ dispose: () => undefined }),
    onDidChangeWindowState: () => ({ dispose: () => undefined }),
    showInformationMessage: async (message: string) => {
      state.messages.push(message)
      return undefined
    },
    showWarningMessage: async (message: string) => {
      state.messages.push(message)
      return undefined
    },
  },
  authentication: { getSession: async () => state.session },
  env: { uriScheme: 'vscode', openExternal: async () => true },
  Uri: { parse: (value: string) => value },
}))

vi.mock('../../src/forge/ghConfig', () => ({
  ghKnowsHost: (host: string) => state.ghHostsKnown.has(host),
  ghHosts: () => [...state.ghHostsKnown],
}))

vi.mock('../../src/forge/glabConfig', () => ({
  glabKnowsHost: (host: string) => state.glabHostsKnown.has(host),
}))

vi.mock('../../src/forge/cli', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/forge/cli')>()),
  cliAvailable: async (binary: string) => (binary === 'gh' ? state.ghBinary : state.glabBinary),
}))

vi.mock('../../src/forge/ghApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/forge/ghApi')>()),
  ghGitCredential: async (_host: string, field: 'username' | 'password') => state.ghGit[field],
}))

import { ForgeService } from '../../src/vscode/forgeService'

function service() {
  const secrets = new Map<string, string>()
  const store = {
    get: async (key: string) => secrets.get(key),
    store: async (key: string, value: string) => void secrets.set(key, value),
    delete: async (key: string) => void secrets.delete(key),
  }
  const registry = { onDidChangeModel: () => ({ dispose: () => undefined }), activeModel: null }
  const logger = { info: () => undefined, warn: () => undefined, error: () => undefined }
  const forge = new ForgeService(registry as never, store as never, logger, 'samuelba.ukemi-jj')
  return { forge, secrets }
}

const git = (host: string, field: 'username' | 'password', interactive = false) => ({
  host,
  field,
  interactive,
})

beforeEach(() => {
  state.trusted = true
  state.session = null
  state.ghHostsKnown = new Set()
  state.ghBinary = true
  state.glabHostsKnown = new Set()
  state.glabBinary = true
  state.messages = []
})

describe('GitHub credentials for git', () => {
  test('prefers a stored token over the editor account and gh', async () => {
    const { forge, secrets } = service()
    secrets.set('ukemi.github.credential.github.com', JSON.stringify({ username: 'u', token: 't' }))
    state.session = { account: { label: 'editor' }, accessToken: 'editor-token' }
    state.ghHostsKnown.add('github.com')

    expect(await forge.gitCredential(git('github.com', 'password'))).toBe('t')
  })

  test('prefers the editor account over gh', async () => {
    const { forge } = service()
    state.session = { account: { label: 'editor' }, accessToken: 'editor-token' }
    state.ghHostsKnown.add('github.com')

    expect(await forge.gitCredential(git('github.com', 'password'))).toBe('editor-token')
  })

  test('falls back to gh when nothing else is signed in', async () => {
    const { forge } = service()
    state.ghHostsKnown.add('github.com')

    expect(await forge.gitCredential(git('github.com', 'username'))).toBe('gh-user')
    expect(await forge.gitCredential(git('github.com', 'password'))).toBe('gh-token')
  })

  test('uses gh for an enterprise host that the editor cannot serve', async () => {
    const { forge } = service()
    state.session = { account: { label: 'editor' }, accessToken: 'editor-token' }
    state.ghHostsKnown.add('ghe.example.com')

    expect(await forge.gitCredential(git('ghe.example.com', 'password'))).toBe('gh-token')
  })

  test('skips gh when the binary is missing', async () => {
    const { forge } = service()
    state.ghHostsKnown.add('github.com')
    state.ghBinary = false

    expect(await forge.gitCredential(git('github.com', 'password'))).toBeNull()
  })

  test('skips gh after sign out', async () => {
    const { forge, secrets } = service()
    state.ghHostsKnown.add('github.com')
    secrets.set('ukemi.github.ghIgnored.github.com', '1')

    expect(await forge.gitCredential(git('github.com', 'password'))).toBeNull()
  })

  test('gives nothing in an untrusted workspace', async () => {
    const { forge } = service()
    state.ghHostsKnown.add('github.com')
    state.trusted = false

    expect(await forge.gitCredential(git('github.com', 'password'))).toBeNull()
  })

  test('treats a host from gh hosts.yml as a GitHub host', async () => {
    const { forge } = service()
    state.ghHostsKnown.add('ghe.example.com')

    expect(await forge.gitCredential(git('ghe.example.com', 'password'))).toBe('gh-token')
    expect(await forge.gitCredential(git('other.example.com', 'password'))).toBeNull()
  })
})

describe('GitLab with glab', () => {
  test('does not hand the glab login to git', async () => {
    const { forge } = service()
    state.glabHostsKnown.add('gitlab.com')

    expect(await forge.gitCredential(git('gitlab.com', 'password'))).toBeNull()
  })

  test('falls through to a stored token when glab is not installed', async () => {
    const { forge, secrets } = service()
    state.glabHostsKnown.add('gitlab.com')
    state.glabBinary = false
    secrets.set('ukemi.gitlab.token.gitlab.com', 'pat')

    expect(await forge.gitCredential(git('gitlab.com', 'password'))).toBe('pat')
  })
})
