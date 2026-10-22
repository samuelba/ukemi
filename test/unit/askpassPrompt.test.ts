import { describe, expect, test } from 'vitest'
import { parsePrompt } from '../../src/askpass/prompt'

describe('parsePrompt', () => {
  test('reads a username prompt', () => {
    expect(parsePrompt("Username for 'https://github.com': ")).toEqual({
      field: 'username',
      host: 'github.com',
    })
  })

  test('reads a password prompt with a user in the URL', () => {
    expect(parsePrompt("Password for 'https://x-access-token@github.com': ")).toEqual({
      field: 'password',
      host: 'github.com',
    })
  })

  test('drops the port and lowers the case of the host', () => {
    expect(parsePrompt("Username for 'https://Git.Example.com:8443': ")).toEqual({
      field: 'username',
      host: 'git.example.com',
    })
  })

  test('ignores prompts that are not for an https remote', () => {
    expect(parsePrompt("Enter passphrase for key '/home/sam/.ssh/id_ed25519': ")).toBeNull()
    expect(parsePrompt("Username for 'http://github.com': ")).toBeNull()
  })
})
