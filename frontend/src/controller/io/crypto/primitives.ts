import { blake2b } from '@noble/hashes/blake2'

export function senderAddress(publicKey: Uint8Array): Uint8Array {
  const data = new Uint8Array(33)
  data[0] = 0x00
  data.set(publicKey, 1)
  return blake2b(data, { dkLen: 32 })
}

