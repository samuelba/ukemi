import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { KeyValueFile } from '../../src/desktop/adapters/keyValueFile'
import { TrustStore } from '../../src/desktop/adapters/trustStore'

function store(initial?: object): KeyValueFile {
  const path = join(mkdtempSync(join(tmpdir(), 'ukemi-trust-')), 'state.json')
  if (initial) {
    writeFileSync(path, JSON.stringify(initial))
  }
  return new KeyValueFile(path)
}

describe('TrustStore', () => {
  test('reads folders trusted in an earlier run', () => {
    const trust = new TrustStore(store({ trustedFolders: ['/work/repo'] }))
    expect(trust.isTrusted('/work/repo')).toBe(true)
    expect(trust.isTrusted('/work/repo/')).toBe(true)
  })

  test('trusts folders inside a trusted one, but not siblings with the same prefix', () => {
    const trust = new TrustStore(store({ trustedFolders: ['/work/repo'] }))
    expect(trust.isTrusted('/work/repo/packages/app')).toBe(true)
    expect(trust.isTrusted('/work/repo-fork')).toBe(false)
  })

  test('remembers a newly trusted folder once', async () => {
    const state = store()
    const trust = new TrustStore(state)
    expect(trust.isTrusted('/work/new')).toBe(false)
    await trust.trust('/work/new')
    await trust.trust('/work/new')
    expect(trust.isTrusted('/work/new')).toBe(true)
    expect(state.get('trustedFolders')).toEqual(['/work/new'])
  })
})
