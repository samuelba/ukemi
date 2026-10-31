import { describe, expect, test } from 'vitest'
import { ghEndpoint, ghFetch, ghGitCredential, parseGitCredential } from '../../src/forge/ghApi'
import { configHosts, ghConfigFile, ghHosts, ghKnowsHost } from '../../src/forge/ghConfig'

const HOSTS = `
github.com:
    git_protocol: https
    users:
        sam:
    user: sam
GHE.Example.com:
    user: sam
`

describe('gh config', () => {
  test('lists host names without reading tokens', () => {
    expect(configHosts(HOSTS)).toEqual(['github.com', 'ghe.example.com'])
    expect(configHosts('github.com: [')).toEqual([])
    expect(configHosts('- a\n- b')).toEqual([])
    expect(configHosts('"bad host":\n  user: x')).toEqual([])
  })

  test('finds the file like gh does', () => {
    expect(ghConfigFile({ GH_CONFIG_DIR: '/c' }, '/h', 'linux')).toBe('/c/hosts.yml')
    expect(ghConfigFile({ XDG_CONFIG_HOME: '/x' }, '/h', 'linux')).toBe('/x/gh/hosts.yml')
    expect(ghConfigFile({ AppData: '/a' }, '/h', 'win32')).toBe('/a/GitHub CLI/hosts.yml')
    expect(ghConfigFile({}, '/h', 'linux')).toBe('/h/.config/gh/hosts.yml')
  })

  test('treats a missing file as no hosts', () => {
    const readFile = () => {
      throw new Error('missing')
    }
    expect(ghHosts({ env: {}, home: '/h', readFile })).toEqual([])
    expect(ghKnowsHost('github.com', { env: {}, home: '/h', readFile })).toBe(false)
  })

  test('matches hosts case-insensitively', () => {
    const options = { env: {}, home: '/h', readFile: () => HOSTS }
    expect(ghKnowsHost('GHE.example.com', options)).toBe(true)
    expect(ghKnowsHost('other.example.com', options)).toBe(false)
  })
})

describe('ghEndpoint', () => {
  test('maps github.com urls', () => {
    expect(ghEndpoint('github.com', 'https://api.github.com/graphql')).toBe('/graphql')
    expect(ghEndpoint('github.com', 'https://api.github.com/repos/o/r/pulls?state=open')).toBe(
      '/repos/o/r/pulls?state=open',
    )
  })

  test('maps enterprise urls', () => {
    expect(ghEndpoint('ghe.example.com', 'https://ghe.example.com/api/graphql')).toBe('/graphql')
    expect(ghEndpoint('ghe.example.com', 'https://GHE.example.com/api/v3/repos/o/r/pulls/1')).toBe(
      '/repos/o/r/pulls/1',
    )
  })

  test.each([
    ['github.com', 'https://github.com/graphql'],
    ['github.com', 'https://evil.example/repos/o/r'],
    ['github.com', 'http://api.github.com/repos/o/r'],
    ['github.com', 'https://user:pw@api.github.com/repos/o/r'],
    ['github.com', 'https://api.github.com:8443/repos/o/r'],
    ['ghe.example.com', 'https://api.github.com/repos/o/r'],
    ['ghe.example.com', 'https://ghe.example.com/repos/o/r'],
    ['ghe.example.com', 'https://ghe.example.com/api/v4/user'],
    ['ghe.example.com', 'https://ghe.example.com/api/v3/repos/o/r?x={owner}'],
    ['not a host', 'https://api.github.com/graphql'],
  ])('refuses %s %s', (host, url) => {
    expect(() => ghEndpoint(host, url)).toThrow()
  })
})

describe('ghFetch', () => {
  test('calls gh api and keeps the token out of the command', async () => {
    const calls: { args: readonly string[]; stdin: string | undefined }[] = []
    const fetchImpl = ghFetch('ghe.example.com', async (args, stdin) => {
      calls.push({ args, stdin })
      return { code: 0, stdout: 'HTTP/2.0 200 OK\nContent-Type: application/json\n\n{"id":1}\n' }
    })

    const response = await fetchImpl('https://ghe.example.com/api/v3/user', {
      headers: { Authorization: 'Bearer must-not-be-forwarded' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 1 })
    expect(calls).toEqual([
      {
        args: ['api', '--hostname', 'ghe.example.com', '--include', '--method', 'GET', '/user'],
        stdin: undefined,
      },
    ])
  })

  test('sends a graphql body on stdin', async () => {
    let seen = ''
    const fetchImpl = ghFetch('github.com', async (args, stdin) => {
      seen = `${args.join(' ')} ${stdin}`
      return { code: 0, stdout: 'HTTP/2.0 200 OK\n\n{"data":{}}\n' }
    })

    await fetchImpl('https://api.github.com/graphql', { method: 'POST', body: '{"query":"q"}' })

    expect(seen).toBe(
      'api --hostname github.com --include --method POST --header Content-Type: application/json --input - /graphql {"query":"q"}',
    )
  })

  test('keeps a body that contains a blank line', async () => {
    const fetchImpl = ghFetch('github.com', async () => ({
      code: 0,
      stdout: 'HTTP/2.0 200 OK\n\n{"body":"a\\n\\nb"}\n\nmore',
    }))

    const response = await fetchImpl('https://api.github.com/user', {})

    expect(await response.text()).toBe('{"body":"a\\n\\nb"}\n\nmore')
  })

  test('reports the status of an error response', async () => {
    const fetchImpl = ghFetch('github.com', async () => ({
      code: 1,
      stdout: 'HTTP/2.0 401 Unauthorized\n\n{"message":"Bad credentials"}\n',
    }))

    expect((await fetchImpl('https://api.github.com/user', {})).status).toBe(401)
  })
})

describe('gh git credential', () => {
  test('reads a field from the helper output', () => {
    const output = 'protocol=https\nhost=github.com\nusername=sam\npassword=gho_a=b\n'
    expect(parseGitCredential(output, 'username')).toBe('sam')
    expect(parseGitCredential(output, 'password')).toBe('gho_a=b')
    expect(parseGitCredential('protocol=https\n', 'password')).toBeNull()
  })

  test('asks gh for the host over stdin', async () => {
    const calls: { args: readonly string[]; stdin: string | undefined }[] = []
    const run = async (args: readonly string[], stdin: string | undefined) => {
      calls.push({ args, stdin })
      return { code: 0, stdout: 'username=sam\npassword=tok\n' }
    }

    expect(await ghGitCredential('github.com', 'password', run)).toBe('tok')
    expect(calls).toEqual([
      { args: ['auth', 'git-credential', 'get'], stdin: 'protocol=https\nhost=github.com\n\n' },
    ])
  })

  test('gives nothing when gh fails, is missing, or the host is unsafe', async () => {
    expect(
      await ghGitCredential('github.com', 'password', async () => ({ code: 1, stdout: '' })),
    ).toBeNull()
    expect(
      await ghGitCredential('github.com', 'password', async () => {
        throw new Error('ENOENT')
      }),
    ).toBeNull()
    let called = false
    expect(
      await ghGitCredential('evil\nhost=x', 'password', async () => {
        called = true
        return { code: 0, stdout: 'password=x' }
      }),
    ).toBeNull()
    expect(called).toBe(false)
  })
})
