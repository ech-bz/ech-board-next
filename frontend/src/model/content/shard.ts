import { blake2b } from '@noble/hashes/blake2'

export function shardIndex(address: Uint8Array, shardCount: number): number {
  const hash = blake2b(address, { dkLen: 32 })
  const view = new DataView(hash.buffer, hash.byteOffset + 24, 8)
  const val = view.getBigUint64(0, false)
  return Number(val % BigInt(shardCount))
}

