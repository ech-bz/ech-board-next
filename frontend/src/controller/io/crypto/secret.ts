import { ristretto255 } from '@noble/curves/ed25519.js'
import { blake2b } from '@noble/hashes/blake2b'
import type { PostPartInput } from '../ech/protocol/types'

export interface SecretKey {
  scalar: bigint
  point: Uint8Array
}

const encoder = new TextEncoder()

function sharedPoint(scalar: bigint, point: Uint8Array): Uint8Array {
  return ristretto255.Point.fromBytes(point).multiply(scalar).toBytes()
}

async function wrapKey(shared: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  const key = blake2b(new Uint8Array([...encoder.encode('secret'), ...shared]), { dkLen: 32 })
  return crypto.subtle.importKey('raw', key.slice().buffer, { name: 'AES-GCM', length: 256 }, false, [usage])
}

async function encryptContent(key: CryptoKey, data: Uint8Array): Promise<{ nonce: Uint8Array; ct: Uint8Array }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(nonce) }, key, new Uint8Array(data))
  return { nonce, ct: new Uint8Array(ct) }
}

async function wrapMasterKey(
  masterKey: CryptoKey,
  scalar: bigint,
  recipient: Uint8Array,
): Promise<{ nonce: Uint8Array; ct: Uint8Array; tag: Uint8Array }> {
  const wrap = await wrapKey(sharedPoint(scalar, recipient), 'encrypt')
  const raw = await crypto.subtle.exportKey('raw', masterKey)
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const wrapped = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(nonce) }, wrap, raw),
  )
  return { nonce, ct: wrapped.slice(0, 32), tag: wrapped.slice(32) }
}

async function unwrapMasterKey(
  entry: { nonce: Uint8Array; ct: Uint8Array; tag: Uint8Array },
  scalar: bigint,
  sender: Uint8Array,
): Promise<CryptoKey> {
  const wrap = await wrapKey(sharedPoint(scalar, sender), 'decrypt')
  const combined = new Uint8Array(entry.ct.length + entry.tag.length)
  combined.set(entry.ct)
  combined.set(entry.tag, entry.ct.length)
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(entry.nonce) }, wrap, combined)
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
}

export async function encryptSecret(
  data: Uint8Array,
  sender: SecretKey,
  recipients: Uint8Array[],
): Promise<PostPartInput> {
  const masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
  const { nonce: dataNonce, ct: dataCt } = await encryptContent(masterKey, data)
  const points: Uint8Array[] = [sender.point]
  for (const point of recipients) {
    if (!points.some((known) => known.length === point.length && known.every((byte, index) => byte === point[index]))) {
      points.push(point)
    }
  }
  const encryptedKeys = []
  for (const point of points) {
    encryptedKeys.push(await wrapMasterKey(masterKey, sender.scalar, point))
  }
  return { Secret: { data_nonce: dataNonce, data_ct: dataCt, encrypted_keys: encryptedKeys } }
}

export async function tryDecryptSecret(
  dataNonce: Uint8Array,
  dataCt: Uint8Array,
  encryptedKeys: { nonce: Uint8Array; ct: Uint8Array; tag: Uint8Array }[],
  self: SecretKey,
  senderPoint: Uint8Array,
): Promise<Uint8Array | null> {
  for (const entry of encryptedKeys) {
    try {
      const masterKey = await unwrapMasterKey(entry, self.scalar, senderPoint)
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(dataNonce) },
        masterKey,
        new Uint8Array(dataCt),
      )
      return new Uint8Array(plain)
    } catch {
      continue
    }
  }
  return null
}
