import { createPublicKey, verify, type KeyObject } from 'node:crypto'
import { blake2b } from '@noble/hashes/blake2.js'
import { sha256 } from '../jj/binary'

// The second line of resources/minisign.pub. scripts/sign-release.sh signs with its secret half,
// which never reaches CI.
export const RELEASE_PUBLIC_KEY = 'RWRGXhU7foXWxTxyz/h4wGJIMU9HSP63yfJ3wEvd5wXuMBYO+BE6gy/i'

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const ALGORITHM_BYTES = 2
const HEADER_BYTES = ALGORITHM_BYTES + 8
const KEY_BYTES = 32
const SIGNATURE_BYTES = 64
const UNTRUSTED_PREFIX = 'untrusted comment:'
const TRUSTED_PREFIX = 'trusted comment: '
const UNREADABLE = "the release's signature is unreadable"
const NOT_SIGNED = "the release's checksums are not signed by the release key"

type ReleaseSums = ReadonlyMap<string, string>

interface MinisignKey {
  id: Buffer
  key: KeyObject
}

interface MinisignSignature {
  keyId: Buffer
  signature: Buffer
  trustedComment: string
  globalSignature: Buffer
}

function decodeBase64(text: string): Buffer | null {
  const decoded = Buffer.from(text, 'base64')
  return decoded.length > 0 && decoded.toString('base64') === text ? decoded : null
}

// Minisign keys and signatures are the algorithm, the key ID and then the key or signature.
function parseBlob(
  encoded: string,
  algorithm: string,
  payloadBytes: number,
): { id: Buffer; payload: Buffer } | null {
  const raw = decodeBase64(encoded)
  if (
    raw?.length !== HEADER_BYTES + payloadBytes ||
    raw.toString('latin1', 0, ALGORITHM_BYTES) !== algorithm
  ) {
    return null
  }
  return { id: raw.subarray(ALGORITHM_BYTES, HEADER_BYTES), payload: raw.subarray(HEADER_BYTES) }
}

function parseKey(encoded: string): MinisignKey {
  const blob = parseBlob(encoded, 'Ed', KEY_BYTES)
  if (!blob) {
    throw new Error('the release key is unreadable')
  }
  const der = Buffer.concat([ED25519_SPKI_PREFIX, blob.payload])
  return { id: blob.id, key: createPublicKey({ key: der, format: 'der', type: 'spki' }) }
}

// Only prehashed signatures ("ED"), the format minisign and rsign write by default.
function parseSignature(text: string): MinisignSignature {
  const lines = text.replace(/\r?\n$/, '').split(/\r?\n/)
  const [untrusted, signatureLine, trusted, globalLine] = lines
  if (
    lines.length !== 4 ||
    !untrusted?.startsWith(UNTRUSTED_PREFIX) ||
    !trusted?.startsWith(TRUSTED_PREFIX)
  ) {
    throw new Error(UNREADABLE)
  }
  const blob = parseBlob(signatureLine ?? '', 'ED', SIGNATURE_BYTES)
  const globalSignature = decodeBase64(globalLine ?? '')
  if (!blob || globalSignature?.length !== SIGNATURE_BYTES) {
    throw new Error(UNREADABLE)
  }
  return {
    keyId: blob.id,
    signature: blob.payload,
    trustedComment: trusted.slice(TRUSTED_PREFIX.length),
    globalSignature,
  }
}

// `sha256sum` lines: the hash, a space, then a space (text) or `*` (binary) and the name.
function parseSums(text: string): ReleaseSums {
  const sums = new Map<string, string>()
  for (const line of text.split('\n')) {
    const match = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line)
    if (match?.[1] && match[2]) {
      sums.set(match[2], match[1].toLowerCase())
    }
  }
  return sums
}

// The version in the signed comment stops an older release's checksums from standing in for a
// newer one's.
export function verifiedReleaseSums(
  sums: Uint8Array,
  signatureText: string,
  version: string,
  publicKey: string = RELEASE_PUBLIC_KEY,
): ReleaseSums {
  const { id, key } = parseKey(publicKey)
  const parsed = parseSignature(signatureText)
  if (!id.equals(parsed.keyId)) {
    throw new Error(`${NOT_SIGNED}, but by another key`)
  }
  if (!verify(null, blake2b(sums), key, parsed.signature)) {
    throw new Error(NOT_SIGNED)
  }
  const signedComment = Buffer.concat([parsed.signature, Buffer.from(parsed.trustedComment)])
  if (!verify(null, signedComment, key, parsed.globalSignature)) {
    throw new Error("the release's trusted comment is not signed by the release key")
  }
  const expected = `ukemi ${version}`
  if (parsed.trustedComment !== expected) {
    throw new Error(`the release's signature is for "${parsed.trustedComment}", not "${expected}"`)
  }
  return parseSums(new TextDecoder().decode(sums))
}

export function releaseFileHash(sums: ReleaseSums, name: string): string {
  const hash = sums.get(name)
  if (!hash) {
    throw new Error(`${name} is missing from the release's checksums`)
  }
  return hash
}

export function checkReleaseFile(sums: ReleaseSums, name: string, content: Uint8Array): void {
  if (sha256(content) !== releaseFileHash(sums, name)) {
    throw new Error(`${name} does not match its checksum`)
  }
}
