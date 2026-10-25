import { describe, expect, test } from 'vitest'
import { glabEndpoint, glabFetch, responseFromGlab } from '../../src/forge/glabApi'
import { configHasHost, glabConfigFile, glabKnowsHost } from '../../src/forge/glabConfig'

const CONFIG = `
hosts:
  git.anybotics.com:
    use_keyring: true
  gitlab.com:
    user: samuelba
`

describe('glab config', () => {
  test('detects a configured host without reading a token', () => {
    expect(configHasHost(CONFIG, 'git.anybotics.com')).toBe(true)
    expect(configHasHost(CONFIG, 'GitLab.com')).toBe(true)
    expect(configHasHost(CONFIG, 'example.com')).toBe(false)
    expect(configHasHost('hosts: [', 'gitlab.com')).toBe(false)
    expect(configHasHost('[]', 'gitlab.com')).toBe(false)
  })

  test('uses GLAB_CONFIG_DIR and treats a missing file as signed out', () => {
    const seen: string[] = []
    expect(
      glabKnowsHost('gitlab.com', {
        env: { GLAB_CONFIG_DIR: '/tmp/glab' },
        home: '/home/sam',
        readFile: (file) => {
          seen.push(file)
          return CONFIG
        },
      }),
    ).toBe(true)
    expect(seen).toEqual(['/tmp/glab/config.yml'])
    expect(
      glabKnowsHost('gitlab.com', {
        env: {},
        home: '/home/sam',
        readFile: () => {
          throw new Error('missing')
        },
      }),
    ).toBe(false)
    expect(glabConfigFile({ XDG_CONFIG_HOME: '/xdg' }, '/home/sam')).toBe('/xdg/glab-cli/config.yml')
  })
})

describe('glab api', () => {
  test('calls glab api and keeps the token out of the command', async () => {
    const calls: { args: readonly string[]; stdin: string | undefined }[] = []
    const fetchImpl = glabFetch('git.anybotics.com', async (args, stdin) => {
      calls.push({ args, stdin })
      return {
        code: 0,
        stdout: 'HTTP/2.0 200 OK\nContent-Type: application/json\n\n{"id":38}\n',
      }
    })

    const response = await fetchImpl('https://git.anybotics.com/api/v4/user', {
      headers: { 'PRIVATE-TOKEN': 'must-not-be-forwarded' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 38 })
    expect(calls).toEqual([
      {
        args: ['api', '--hostname', 'git.anybotics.com', '--include', '--method', 'GET', '/user'],
        stdin: undefined,
      },
    ])
  })

  test('sends a JSON body on stdin', async () => {
    let seen = ''
    const fetchImpl = glabFetch('gitlab.com', async (args, stdin) => {
      seen = `${args.join(' ')} ${stdin}`
      return { code: 0, stdout: 'HTTP/2.0 201 Created\n\n{"iid":1}\n' }
    })

    const response = await fetchImpl('https://gitlab.com/api/v4/projects/group%2Fname/merge_requests', {
      method: 'POST',
      body: '{"title":"x"}',
    })

    expect(response.status).toBe(201)
    expect(seen).toBe(
      'api --hostname gitlab.com --include --method POST --input - /projects/group%2Fname/merge_requests {"title":"x"}',
    )
  })

  test('reads the status from an error response', () => {
    const response = responseFromGlab('HTTP/2.0 401 Unauthorized\n\n{"message":"401 Unauthorized"}\n', 1)
    expect(response.status).toBe(401)
  })

  test('refuses a url that is not the configured host', () => {
    expect(() => glabEndpoint('git.anybotics.com', 'https://gitlab.com/api/v4/user')).toThrow(
      'Refusing GitLab URL',
    )
    expect(() => glabEndpoint('not a host', 'https://gitlab.com/api/v4/user')).toThrow(
      'Invalid GitLab host',
    )
  })
})
