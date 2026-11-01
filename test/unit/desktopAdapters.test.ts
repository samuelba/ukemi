import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { DesktopHostMessage } from '../../shared/desktopProtocol'
import { KeyValueFile } from '../../src/desktop/adapters/keyValueFile'
import { RendererUi } from '../../src/desktop/adapters/rendererUi'
import { SecretsFile, type Encryptor } from '../../src/desktop/adapters/secretsFile'
import { SettingsFile } from '../../src/desktop/adapters/settingsFile'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ukemi-desktop-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function rendererUi() {
  const sent: DesktopHostMessage[] = []
  const native = {
    ask: vi.fn(async () => 'Yes'),
    pickFolder: vi.fn(async () => '/tmp/repo'),
    openExternal: vi.fn(async () => true),
    copy: vi.fn(),
  }
  const ui = new RendererUi((message) => sent.push(message), native)
  const lastRequest = () => {
    const request = sent.filter((m) => m.type === 'desktop.ui').at(-1)
    if (request?.type !== 'desktop.ui') {
      throw new Error('no request sent')
    }
    return request
  }
  return { ui, sent, native, lastRequest }
}

describe('RendererUi', () => {
  test('resolves an input with the text the shell answers', async () => {
    const { ui, lastRequest } = rendererUi()
    const result = ui.input({ title: 'Name' })
    const request = lastRequest()
    expect(request.request).toMatchObject({ kind: 'input', title: 'Name' })
    ui.answer(request.id, { kind: 'text', value: 'feature' })
    expect(await result).toBe('feature')
  })

  test('keeps an input open with the problem until the value is valid', async () => {
    const { ui, sent, lastRequest } = rendererUi()
    const result = ui.input({ validate: (v) => (v.includes(' ') ? 'No spaces' : null) })
    const { id } = lastRequest()
    ui.answer(id, { kind: 'text', value: 'bad name' })
    expect(sent.at(-1)).toEqual({ type: 'desktop.uiInvalid', id, problem: 'No spaces' })
    ui.answer(id, { kind: 'text', value: 'good' })
    expect(await result).toBe('good')
    expect(sent.at(-1)).toEqual({ type: 'desktop.uiClose', id })
  })

  test('maps picked indexes back to the items with their extra fields', async () => {
    const { ui, lastRequest } = rendererUi()
    const items = [
      { label: 'a', id: 1 },
      { label: 'b', id: 2 },
      { label: 'c', id: 3 },
    ]
    const one = ui.pick(items)
    ui.answer(lastRequest().id, { kind: 'item', index: 1 })
    expect(await one).toEqual({ label: 'b', id: 2 })

    const many = ui.pickMany(items)
    ui.answer(lastRequest().id, { kind: 'items', indexes: [0, 2] })
    expect((await many)?.map((item) => item.id)).toEqual([1, 3])
  })

  test('sends only the shown fields of pick items', () => {
    const { ui, lastRequest } = rendererUi()
    void ui.pick([{ label: 'a', description: 'd', secret: 'x' }])
    expect(lastRequest().request).toMatchObject({ items: [{ label: 'a', description: 'd' }] })
    expect(JSON.stringify(lastRequest().request)).not.toContain('secret')
  })

  test('a typed pick answers free text and follows item updates', async () => {
    const { ui, sent, lastRequest } = rendererUi()
    const pick = ui.pickOrType([{ label: 'main' }])
    const { id } = lastRequest()
    pick.update([{ label: 'main' }, { label: 'feature' }])
    expect(sent.at(-1)).toMatchObject({ type: 'desktop.uiUpdate', id })
    ui.answer(id, { kind: 'item', index: 1 })
    expect(await pick.choice).toEqual({ label: 'feature' })

    const typed = ui.pickOrType([])
    ui.answer(lastRequest().id, { kind: 'text', value: '  trunk()  ' })
    expect(await typed.choice).toBe('trunk()')
  })

  test('validates a typed pick by its label', async () => {
    const { ui, sent, lastRequest } = rendererUi()
    const pick = ui.pickOrType([{ label: 'bad name' }], {
      validate: (v) => (v.includes(' ') ? 'No spaces' : null),
    })
    const { id } = lastRequest()
    ui.answer(id, { kind: 'item', index: 0 })
    expect(sent.at(-1)).toMatchObject({ type: 'desktop.uiInvalid', id })
    ui.answer(id, { kind: 'cancel' })
    expect(await pick.choice).toBeUndefined()
  })

  test('closes the progress indicator when the task fails', async () => {
    const { ui, sent, lastRequest } = rendererUi()
    await expect(
      ui.progress('Cloning', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(sent.at(-1)).toEqual({ type: 'desktop.uiClose', id: lastRequest().id })
  })

  test('resolves open prompts as dismissed when the window closes', async () => {
    const { ui } = rendererUi()
    const result = ui.warn('careful', 'Retry')
    ui.cancelAll()
    expect(await result).toBeUndefined()
  })

  test('opens only web and mail links', async () => {
    const { ui, native } = rendererUi()
    expect(await ui.openExternal('file:///etc/passwd')).toBe(false)
    expect(await ui.openExternal('https://github.com')).toBe(true)
    expect(native.openExternal).toHaveBeenCalledTimes(1)
  })
})

describe('KeyValueFile', () => {
  test('keeps values across instances and keeps scopes apart', async () => {
    const path = join(tempDir(), 'state.json')
    const store = new KeyValueFile(path)
    await store.scoped('/repo/a').update('active', 'x')
    await store.scoped('/repo/b').update('active', 'y')
    const reopened = new KeyValueFile(path)
    expect(reopened.scoped('/repo/a').get('active')).toBe('x')
    expect(reopened.scoped('/repo/b').get('active')).toBe('y')
    await reopened.update('/repo/a\nactive', undefined)
    expect(new KeyValueFile(path).scoped('/repo/a').get('active')).toBeUndefined()
  })
})

describe('SecretsFile', () => {
  const reversible: Encryptor = {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from([...plain].reverse().join('')),
    decryptString: (data) => [...data.toString()].reverse().join(''),
  }

  test('stores secrets encrypted and reads them back', async () => {
    const path = join(tempDir(), 'secrets.json')
    const secrets = new SecretsFile(path, reversible)
    await secrets.store('token', 'abc123')
    expect(readFileSync(path, 'utf8')).not.toContain('abc123')
    expect(await new SecretsFile(path, reversible).get('token')).toBe('abc123')
    await secrets.delete('token')
    expect(await secrets.get('token')).toBeUndefined()
  })

  test('keeps secrets in memory only when the keychain is missing', async () => {
    const path = join(tempDir(), 'secrets.json')
    const onUnavailable = vi.fn()
    const secrets = new SecretsFile(
      path,
      { ...reversible, isEncryptionAvailable: () => false },
      onUnavailable,
    )
    await secrets.store('token', 'abc123')
    expect(await secrets.get('token')).toBe('abc123')
    expect(onUnavailable).toHaveBeenCalled()
    expect(() => readFileSync(path, 'utf8')).toThrow()
  })

  test('reads a value it cannot decrypt as missing', async () => {
    const path = join(tempDir(), 'secrets.json')
    writeFileSync(path, JSON.stringify({ token: 'garbage' }))
    const broken: Encryptor = {
      ...reversible,
      decryptString: () => {
        throw new Error('bad')
      },
    }
    expect(await new SecretsFile(path, broken).get('token')).toBeUndefined()
  })
})

describe('SettingsFile', () => {
  test('reads defaults for missing keys and stored values for the rest', () => {
    const path = join(tempDir(), 'settings.json')
    writeFileSync(path, JSON.stringify({ 'autoFetch.enabled': true, historyDepth: '30d' }))
    const settings = new SettingsFile(path)
    expect(settings.read()).toMatchObject({
      autoFetchEnabled: true,
      historyDepth: '30d',
      changeIdLength: 4,
    })
    settings.dispose()
  })

  test('reports which keys an update changed', async () => {
    const settings = new SettingsFile(join(tempDir(), 'settings.json'))
    const changes: Array<(key: string) => boolean> = []
    settings.onDidChange((change) => changes.push((key) => change.affects(key)))
    await settings.update('showGitTags', false)
    await settings.update('showGitTags', false)
    expect(changes).toHaveLength(1)
    expect(changes[0]?.('showGitTags')).toBe(true)
    expect(changes[0]?.('autoFetch.enabled')).toBe(false)
    expect(settings.read().showGitTags).toBe(false)
    settings.dispose()
  })

  test('falls back to defaults for a broken file', () => {
    const path = join(tempDir(), 'settings.json')
    writeFileSync(path, '{ not json')
    const settings = new SettingsFile(path)
    expect(settings.read().defaultFilter).toBe('recent')
    settings.dispose()
  })
})
