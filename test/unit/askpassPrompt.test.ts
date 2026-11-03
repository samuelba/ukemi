import { describe, expect, test } from 'vitest'
import { parseOtherPrompt, parsePrompt } from '../../src/askpass/prompt'

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

describe('parseOtherPrompt', () => {
  test('asks for a key passphrase or a password as a secret', () => {
    expect(parseOtherPrompt("Enter passphrase for key '/home/sam/.ssh/id_ed25519': ")).toEqual({
      text: "Enter passphrase for key '/home/sam/.ssh/id_ed25519':",
      answer: 'secret',
    })
    expect(parseOtherPrompt("git@example.com's password: ")?.answer).toBe('secret')
  })

  test('asks whether to trust a new host key', () => {
    const prompt = [
      "The authenticity of host 'example.com (192.0.2.1)' can't be established.",
      'ED25519 key fingerprint is SHA256:abc.',
      'Are you sure you want to continue connecting (yes/no/[fingerprint])? ',
    ].join('\n')
    expect(parseOtherPrompt(prompt)?.answer).toBe('confirm')
  })

  test('follows the kind of prompt that ssh sets', () => {
    expect(parseOtherPrompt('Allow use of key?', 'confirm')?.answer).toBe('confirm')
    expect(parseOtherPrompt('Confirm user presence for key', 'none')?.answer).toBe('notice')
  })

  test('shows a username prompt in plain text', () => {
    expect(parseOtherPrompt("Username for 'http://example.com': ")?.answer).toBe('text')
  })

  test('ignores an empty prompt', () => {
    expect(parseOtherPrompt('  ')).toBeNull()
  })
})
