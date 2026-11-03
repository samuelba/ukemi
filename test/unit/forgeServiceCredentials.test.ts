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

import { ForgeService } from '../../src/app/forgeService'
import { readSettings } from '../../src/app/settings'

const NO_EVENT = () => ({ dispose: () => undefined })

// The editor account only serves github.com, as without a `github-enterprise.uri`.
const editorSession = async (host: string) =>
  host === 'github.com' && state.session
    ? { username: state.session.account.label, token: state.session.accessToken }
    : null

function service() {
  const secrets = new Map<string, string>()
  const store = {
    get: async (key: string) => secrets.get(key),
    store: async (key: string, value: string) => void secrets.set(key, value),
    delete: async (key: string) => void secrets.delete(key),
  }
  const message = async (text: string) => {
    state.messages.push(text)
    return undefined
  }
  const host = {
    secrets: store,
    settings: {
      read: () => readSettings({ get: (_key, fallback) => fallback }),
      update: async () => undefined,
      onDidChange: NO_EVENT,
    },
    window: {
      isFocused: true,
      onDidFocus: NO_EVENT,
      get isTrusted() {
        return state.trusted
      },
      onDidGrantTrust: NO_EVENT,
    },
    ui: { info: message, warn: message, openExternal: async () => true },
  }
  const registry = { onDidChangeModel: NO_EVENT, activeModel: null }
  const logger = { info: () => undefined, warn: () => undefined, error: () => undefined }
  const accounts = {
    githubSession: editorSession,
    gitlabRedirect: {
      prepare: async () => 'test://gitlab-auth',
      onDidRedirect: NO_EVENT,
      dispose: () => undefined,
    },
    untrustedMessage: 'untrusted',
  }
  const forge = new ForgeService(registry as never, host as never, logger, accounts)
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

describe('refreshRequests', () => {
  test('runs a forced refresh again once the running one ends', async () => {
    const { forge } = service()
    let release = () => undefined as void
    const first = new Promise<never[]>((resolve) => {
      release = () => resolve([])
    })
    const remotes = vi.fn().mockReturnValueOnce(first).mockResolvedValue([])
    const model = { root: '/repo', repo: { remotes }, setForge: vi.fn() }

    const background = forge.refreshRequests(model as never)
    // Like creating a request while the 60 s refresh still reads the old list.
    const forced = forge.refreshRequests(model as never, { force: true })
    release()
    await Promise.all([background, forced])

    expect(remotes).toHaveBeenCalledTimes(2)
  })

  test('skips a background refresh while one is running', async () => {
    const { forge } = service()
    const remotes = vi.fn().mockResolvedValue([])
    const model = { root: '/repo', repo: { remotes }, setForge: vi.fn() }

    await Promise.all([
      forge.refreshRequests(model as never),
      forge.refreshRequests(model as never),
    ])

    expect(remotes).toHaveBeenCalledTimes(1)
  })
})

describe('request refresh and rate limits', () => {
  function githubModel() {
    const states: unknown[] = []
    const model = {
      root: '/repo',
      remotes: [{ name: 'origin', url: 'https://github.com/o/r.git' }],
      graph: {
        commits: [{ localBookmarks: [{ name: 'feature' }], remoteBookmarks: [], requests: [] }],
      },
      setForge: (state: unknown) => states.push(state),
    }
    return { model: model as never, states }
  }

  function answer(status: number, headers: Record<string, string>, body: unknown) {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url)
      return new Response(JSON.stringify(body), { status, headers })
    })
    return calls
  }

  async function signedIn() {
    const setup = service()
    setup.secrets.set(
      'ukemi.github.credential.github.com',
      JSON.stringify({ username: 'u', token: 't' }),
    )
    return setup
  }

  test('reports a used-up rate limit instead of an expired login, and waits', async () => {
    const { forge } = await signedIn()
    const { model } = githubModel()
    const reset = Math.floor(Date.now() / 1000) + 590
    const calls = answer(
      403,
      { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
      { message: 'API rate limit exceeded for user.' },
    )

    await forge.refreshRequests(model, { force: true })
    expect(state.messages).toEqual([
      "Ukemi: the forge's rate limit is used up. Request status refreshes again in 10 min.",
    ])
    const afterFirst = calls.length

    await forge.refreshRequests(model)
    expect(calls).toHaveLength(afterFirst)
    forge.dispose()
    vi.unstubAllGlobals()
  })

  test('shows another forge error once', async () => {
    const { forge } = await signedIn()
    answer(200, {}, { errors: [{ type: 'NOT_FOUND', message: 'Could not resolve o/r.' }] })
    const { model } = githubModel()

    await forge.refreshRequests(model, { force: true })
    await forge.refreshRequests(model, { force: true })
    expect(state.messages).toEqual([
      'Ukemi could not load the requests. GitHub: Could not resolve o/r.',
    ])
    forge.dispose()
    vi.unstubAllGlobals()
  })

  test('still reports an expired login', async () => {
    const { forge } = await signedIn()
    answer(401, {}, { message: 'Bad credentials' })

    await forge.refreshRequests(githubModel().model, { force: true })
    expect(state.messages).toEqual(['Ukemi: the forge login has expired. Sign in again.'])
    forge.dispose()
    vi.unstubAllGlobals()
  })
})
