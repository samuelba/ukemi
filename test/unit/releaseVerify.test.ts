import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { blake2b } from '@noble/hashes/blake2.js'
import { describe, expect, test } from 'vitest'
import {
  checkReleaseFile,
  RELEASE_PUBLIC_KEY,
  releaseFileHash,
  verifiedReleaseSums,
} from '../../src/desktop/releaseVerify'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

const SUMS_TEXT = `aaaa${'0'.repeat(60)}  install.sh\nbbbb${'0'.repeat(60)}  Ukemi-1.2.3.AppImage\n`
const SUMS = bytes(SUMS_TEXT)

// Made by `rsign sign -t 'ukemi 1.2.3'` with a throwaway key, to pin the real file format.
const RSIGN_KEY = 'RWQ3T9Ay2Byc5hZfK47R4o7xvf/n6JGnVuCPBNRzerGb4A/FdZqLaxkA'
const RSIGN_SIGNATURE = `untrusted comment: signature from rsign secret key
RUQ3T9Ay2Byc5ubCmS7C62TBXDdJFAFmMMGOSQCODujSCRncaqvpCxHzA1HP6Vy/I3BWQ8HfkfSRrPLvSvv1WfSH3TsbfQVYbQY=
trusted comment: ukemi 1.2.3
ZMAfe0oklJefufe2skaGBPU8+6WjFqV/SjYulpDWvkpjqmdFozH1K9kUr2uFO5SKyxhhsWyVj2dWCeSP4Fo3Cw==
`

const KEY_ID = Buffer.from('0102030405060708', 'hex')

interface TestKey {
  privateKey: KeyObject
  encoded: string
}

function testKey(keyId: Uint8Array = KEY_ID): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
  return {
    privateKey,
    encoded: Buffer.concat([Buffer.from('Ed'), keyId, raw]).toString('base64'),
  }
}

interface SignOptions {
  comment?: string
  signedComment?: string
  algorithm?: 'ED' | 'Ed'
  keyId?: Uint8Array
}

function signature(key: TestKey, data: Uint8Array, options: SignOptions = {}): string {
  const algorithm = options.algorithm ?? 'ED'
  const comment = options.comment ?? 'ukemi 1.2.3'
  const message = algorithm === 'ED' ? blake2b(data) : data
  const signed = sign(null, message, key.privateKey)
  const global = sign(
    null,
    Buffer.concat([signed, Buffer.from(options.signedComment ?? comment)]),
    key.privateKey,
  )
  const line = Buffer.concat([Buffer.from(algorithm), options.keyId ?? KEY_ID, signed]).toString(
    'base64',
  )
  return `untrusted comment: test\n${line}\ntrusted comment: ${comment}\n${global.toString('base64')}\n`
}

describe('verifiedReleaseSums', () => {
  test('the shipped key is the one the release script verifies with', () => {
    const lines = readFileSync('resources/minisign.pub', 'utf8').trim().split('\n')
    expect(lines[1]).toBe(RELEASE_PUBLIC_KEY)
    const signed = signature(testKey(), SUMS)
    expect(() => verifiedReleaseSums(SUMS, signed, '1.2.3')).toThrow(/not signed/)
  })

  test('the release workflow pins the same key', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
    expect(workflow).toContain(`RELEASE_PUBLIC_KEY: ${RELEASE_PUBLIC_KEY}\n`)
  })

  test('accepts a signature made by rsign', () => {
    const sums = verifiedReleaseSums(SUMS, RSIGN_SIGNATURE, '1.2.3', RSIGN_KEY)
    expect(releaseFileHash(sums, 'install.sh')).toBe(`aaaa${'0'.repeat(60)}`)
  })

  test('accepts CRLF line endings in the signature file', () => {
    const crlf = RSIGN_SIGNATURE.replaceAll('\n', '\r\n')
    expect(() => verifiedReleaseSums(SUMS, crlf, '1.2.3', RSIGN_KEY)).not.toThrow()
  })

  test('rejects changed checksums', () => {
    const tampered = bytes(SUMS_TEXT.replace('aaaa', 'cccc'))
    expect(() => verifiedReleaseSums(tampered, RSIGN_SIGNATURE, '1.2.3', RSIGN_KEY)).toThrow(
      /not signed/,
    )
  })

  test('rejects a signature from another key with the same key ID', () => {
    const signed = signature(testKey(), SUMS)
    expect(() => verifiedReleaseSums(SUMS, signed, '1.2.3', testKey().encoded)).toThrow(
      /not signed/,
    )
  })

  test('rejects a signature that names another key', () => {
    const key = testKey()
    const signed = signature(key, SUMS, { keyId: Buffer.from('ffffffffffffffff', 'hex') })
    expect(() => verifiedReleaseSums(SUMS, signed, '1.2.3', key.encoded)).toThrow(/another key/)
  })

  test('rejects a changed trusted comment', () => {
    const key = testKey()
    const signed = signature(key, SUMS, { comment: 'ukemi 1.2.4', signedComment: 'ukemi 1.2.3' })
    expect(() => verifiedReleaseSums(SUMS, signed, '1.2.4', key.encoded)).toThrow(/comment/)
  })

  test('rejects checksums signed for another version', () => {
    expect(() => verifiedReleaseSums(SUMS, RSIGN_SIGNATURE, '1.2.4', RSIGN_KEY)).toThrow(
      /ukemi 1\.2\.3/,
    )
  })

  test('rejects checksums signed for another product', () => {
    const key = testKey()
    const signed = signature(key, SUMS, { comment: 'dropshade 1.2.3' })
    expect(() => verifiedReleaseSums(SUMS, signed, '1.2.3', key.encoded)).toThrow(/dropshade/)
  })

  test('rejects legacy signatures, which are not prehashed', () => {
    const key = testKey()
    const signed = signature(key, SUMS, { algorithm: 'Ed' })
    expect(() => verifiedReleaseSums(SUMS, signed, '1.2.3', key.encoded)).toThrow(/unreadable/)
  })

  test.each([
    ['empty', ''],
    ['nonsense', 'nonsense'],
    ['bad base64', 'untrusted comment: x\n!!!\ntrusted comment: ukemi 1.2.3\n!!!\n'],
    ['short signature', 'untrusted comment: x\nRUQ=\ntrusted comment: ukemi 1.2.3\nRUQ=\n'],
    ['missing comment prefix', RSIGN_SIGNATURE.replace('\ntrusted comment: ', '\n')],
  ])('rejects a garbled signature: %s', (_name, garbled) => {
    expect(() => verifiedReleaseSums(SUMS, garbled, '1.2.3', RSIGN_KEY)).toThrow(/unreadable/)
  })

  test('rejects an unreadable public key', () => {
    expect(() => verifiedReleaseSums(SUMS, RSIGN_SIGNATURE, '1.2.3', 'RWQ=')).toThrow(/release key/)
  })
})

describe('release files', () => {
  const content = bytes('echo hi\n')
  const hash = createHash('sha256').update(content).digest('hex')
  const key = testKey()
  const text = `${hash} *install.sh\nshort  a\n${'z'.repeat(64)}  b\n`
  const sums = verifiedReleaseSums(bytes(text), signature(key, bytes(text)), '1.2.3', key.encoded)

  test('accepts content that matches its hash, in binary sha256sum format too', () => {
    expect(() => checkReleaseFile(sums, 'install.sh', content)).not.toThrow()
  })

  test('rejects content that does not match', () => {
    expect(() => checkReleaseFile(sums, 'install.sh', bytes('echo bye\n'))).toThrow(/checksum/)
  })

  test('rejects a file the checksums do not list, and ignores malformed lines', () => {
    expect(() => releaseFileHash(sums, 'other')).toThrow(/missing/)
    expect(() => releaseFileHash(sums, 'a')).toThrow(/missing/)
    expect(() => releaseFileHash(sums, 'b')).toThrow(/missing/)
  })
})
