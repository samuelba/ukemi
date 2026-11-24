import { describe, expect, test } from 'vitest'
import { SshHosts, type SshRun } from '../../src/forge/sshHosts'

function fakeSsh(output: Record<string, string>) {
  const asked: string[] = []
  const run: SshRun = async (args) => {
    const alias = args[args.length - 1] ?? ''
    asked.push(alias)
    const stdout = output[alias]
    return stdout === undefined ? { code: 255, stdout: '' } : { code: 0, stdout }
  }
  return { run, asked }
}

describe('SshHosts', () => {
  test('resolves an alias to the host name of the SSH config', async () => {
    const { run } = fakeSsh({ 'github-work': 'user git\nhostname github.com\nport 22\n' })

    const aliases = await new SshHosts(run).resolve(['github-work'])

    expect([...aliases]).toEqual([['github-work', 'github.com']])
  })

  test('leaves out hosts that are not aliases or fail', async () => {
    const { run } = fakeSsh({ 'git.example.com': 'hostname git.example.com\n' })

    const aliases = await new SshHosts(run).resolve(['git.example.com', 'broken'])

    expect(aliases.size).toBe(0)
  })

  test('asks ssh once per host', async () => {
    const { run, asked } = fakeSsh({ 'github-work': 'hostname github.com\n' })
    const hosts = new SshHosts(run)

    await hosts.resolve(['github-work'])
    await hosts.resolve(['github-work'])

    expect(asked).toEqual(['github-work'])
  })

  test('asks again after ssh failed', async () => {
    const { run, asked } = fakeSsh({})
    const hosts = new SshHosts(run)

    await hosts.resolve(['github-work'])
    await hosts.resolve(['github-work'])

    expect(asked).toEqual(['github-work', 'github-work'])
  })

  test('asks again after ssh could not start', async () => {
    let calls = 0
    const hosts = new SshHosts(async () => {
      calls += 1
      throw new Error('spawn ssh ENOENT')
    })

    expect((await hosts.resolve(['github-work'])).size).toBe(0)
    await hosts.resolve(['github-work'])
    expect(calls).toBe(2)
  })

  test.each(['-oProxyCommand=touch x', 'a b', 'host;rm', ''])(
    'never passes %j to ssh',
    async (host) => {
      const { run, asked } = fakeSsh({})

      await new SshHosts(run).resolve([host])

      expect(asked).toEqual([])
    },
  )

  test('ignores a host name that is not a valid server name', async () => {
    const { run } = fakeSsh({ alias: 'hostname %h.evil/../x\n' })

    expect((await new SshHosts(run).resolve(['alias'])).size).toBe(0)
  })
})
