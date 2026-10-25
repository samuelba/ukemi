import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { AskpassServer, type CredentialRequest } from '../../src/askpass/server'

const HELPER = join(__dirname, '../../src/askpass/askpassMain.ts')
const NODE_ARGS = ['--experimental-strip-types', '--no-warnings', HELPER]

let server: AskpassServer
const requests: CredentialRequest[] = []

beforeEach(async () => {
  requests.length = 0
  server = new AskpassServer(process.execPath, NODE_ARGS, async (request) => {
    requests.push(request)
    if (request.host !== 'github.com') {
      return null
    }
    return request.field === 'username' ? 'x-access-token' : 'secret-token'
  })
  await server.start()
})

afterEach(() => server.dispose())

function ask(prompt: string, env: Record<string, string> = server.env) {
  return new Promise<{ status: number | null; stdout: string }>((resolve, reject) => {
    const child = spawn(env.GIT_ASKPASS ?? '', [prompt], { env: { ...process.env, ...env } })
    let stdout = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, stdout }))
  })
}

describe('AskpassServer', () => {
  test('answers the username and the password for a known host', async () => {
    expect(await ask("Username for 'https://github.com': ")).toEqual({
      status: 0,
      stdout: 'x-access-token\n',
    })
    expect(await ask("Password for 'https://x-access-token@github.com': ")).toEqual({
      status: 0,
      stdout: 'secret-token\n',
    })
  })

  test('fails without output for an unknown host', async () => {
    expect(await ask("Username for 'https://example.com': ")).toEqual({ status: 1, stdout: '' })
  })

  test('tells the resolver when the fetch must not ask for credentials', async () => {
    const env = { ...server.env, UKEMI_ASKPASS_INTERACTIVE: '0' }

    expect(await ask("Password for 'https://github.com': ", env)).toEqual({
      status: 0,
      stdout: 'secret-token\n',
    })
    expect(requests.at(-1)?.interactive).toBe(false)
  })

  test('asks for credentials when the fetch is interactive', async () => {
    expect(await ask("Username for 'https://github.com': ")).toEqual({
      status: 0,
      stdout: 'x-access-token\n',
    })
    expect(requests.at(-1)?.interactive).toBe(true)
  })

  test('fails for prompts it cannot read, without asking for credentials', async () => {
    expect(await ask('Enter passphrase: ')).toEqual({ status: 1, stdout: '' })
    expect(requests).toEqual([])
  })

  test('refuses a helper with the wrong key', async () => {
    const env = { ...server.env, UKEMI_ASKPASS_NONCE: 'wrong' }

    expect(await ask("Username for 'https://github.com': ", env)).toEqual({
      status: 1,
      stdout: '',
    })
    expect(requests).toEqual([])
  })

  test('gives git the credentials when no credential helper has them', async () => {
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn('git', ['credential', 'fill'], {
        env: {
          ...process.env,
          ...server.env,
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_TERMINAL_PROMPT: '0',
        },
      })
      let stdout = ''
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk
      })
      child.on('error', reject)
      child.on('close', () => resolve(stdout))
      child.stdin.end('protocol=https\nhost=github.com\n\n')
    })

    expect(result).toContain('username=x-access-token\n')
    expect(result).toContain('password=secret-token\n')
  })

  test('keeps the socket in a folder that only the user can open', () => {
    const socket = server.env.UKEMI_ASKPASS_SOCKET ?? ''

    expect(statSync(dirname(socket)).mode & 0o077).toBe(0)
  })
})
