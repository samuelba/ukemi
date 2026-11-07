import { describe, expect, test } from 'vitest'
import { ghEnvToken, ghHosts, ghKnowsHost } from '../../src/forge/ghConfig'
import { glabEnvToken, glabKnowsHost } from '../../src/forge/glabConfig'
import { cliTokenEnv } from '../../src/util/hostProcess'

const noFile = (): string => {
  throw new Error('missing')
}

describe('gh token variables', () => {
  test.each([
    ['github.com', { GH_TOKEN: 'x' }, true],
    ['github.com', { GITHUB_TOKEN: 'x' }, true],
    ['GitHub.com', { GITHUB_TOKEN: 'x' }, true],
    ['acme.ghe.com', { GH_TOKEN: 'x' }, true],
    ['github.com', { GH_ENTERPRISE_TOKEN: 'x' }, false],
    ['ghe.corp', { GH_ENTERPRISE_TOKEN: 'x' }, true],
    ['ghe.corp', { GITHUB_ENTERPRISE_TOKEN: 'x' }, true],
    ['ghe.corp', { GH_TOKEN: 'x' }, false],
    ['github.com', { GH_TOKEN: '' }, false],
  ])('%s with %o counts: %s', (host, env, expected) => {
    expect(ghEnvToken(host, env)).toBe(expected)
  })

  test('counts a token variable without a hosts.yml', () => {
    const options = { env: {}, home: '/h', readFile: noFile }

    expect(ghKnowsHost('github.com', { ...options, tokenEnv: { GITHUB_TOKEN: 'x' } })).toBe(true)
    expect(ghKnowsHost('github.com', { ...options, tokenEnv: {} })).toBe(false)
  })

  test('adds the GH_HOST of an enterprise token to the GitHub hosts', () => {
    const options = { env: {}, home: '/h', readFile: noFile }

    expect(
      ghHosts({ ...options, tokenEnv: { GH_HOST: 'GHE.corp', GH_ENTERPRISE_TOKEN: 'x' } }),
    ).toEqual(['ghe.corp'])
    expect(ghHosts({ ...options, tokenEnv: { GH_HOST: 'ghe.corp' } })).toEqual([])
  })
})

describe('glab token variables', () => {
  test.each([
    ['gitlab.com', { GITLAB_TOKEN: 'x' }, true],
    ['gitlab.com', { GITLAB_ACCESS_TOKEN: 'x' }, true],
    ['gitlab.com', { OAUTH_TOKEN: 'x' }, true],
    ['git.corp', { GITLAB_TOKEN: 'x' }, false],
    ['git.corp', { GITLAB_TOKEN: 'x', GITLAB_HOST: 'git.corp' }, true],
    ['git.corp', { GITLAB_TOKEN: 'x', GITLAB_HOST: 'https://Git.Corp/' }, true],
    ['git.corp', { GITLAB_TOKEN: 'x', GL_HOST: 'git.corp' }, true],
    ['gitlab.com', { GITLAB_TOKEN: 'x', GITLAB_HOST: 'git.corp' }, false],
    ['gitlab.com', { GITLAB_HOST: 'gitlab.com' }, false],
  ])('%s with %o counts: %s', (host, env, expected) => {
    expect(glabEnvToken(host, env)).toBe(expected)
  })

  test('counts a token variable without a config file', () => {
    const options = { env: {}, home: '/h', readFile: noFile }

    expect(glabKnowsHost('gitlab.com', { ...options, tokenEnv: { GITLAB_TOKEN: 'x' } })).toBe(true)
    expect(glabKnowsHost('gitlab.com', { ...options, tokenEnv: {} })).toBe(false)
  })
})

describe('cliTokenEnv', () => {
  test('ignores the sandbox variables inside a Flatpak', () => {
    expect(cliTokenEnv({ GH_TOKEN: 'x' })).toEqual({ GH_TOKEN: 'x' })
    expect(cliTokenEnv({ GH_TOKEN: 'x', FLATPAK_ID: 'dev.ukemi.Ukemi' })).toEqual({})
  })
})
