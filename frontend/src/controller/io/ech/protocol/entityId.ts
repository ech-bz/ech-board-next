import { bcs } from '@mysten/bcs'
import { blake2b } from '@noble/hashes/blake2b'
import { toHex } from '../../../../model/content/hex'

const head = bcs.tuple([bcs.string(), bcs.string()])
const text = bcs.string()
const number = bcs.u64()

export type KeyPart = string | number

export class EntityId {
  static entity(collection: string, ...key: KeyPart[]): string {
    const prefix = head.serialize(['ech/entity', collection]).toBytes()
    const parts = key.map((part) =>
      typeof part === 'string'
        ? text.serialize(part).toBytes()
        : number.serialize(part).toBytes(),
    )
    const size = parts.reduce((total, part) => total + part.length, prefix.length)
    const bytes = new Uint8Array(size)
    bytes.set(prefix)
    let offset = prefix.length
    for (const part of parts) {
      bytes.set(part, offset)
      offset += part.length
    }
    return toHex(blake2b(bytes, { dkLen: 32 }))
  }

  static forum(): string {
    return EntityId.entity('forum')
  }

  static board(slug: string): string {
    return EntityId.entity('board', slug)
  }

  static thread(slug: string, number: number): string {
    return EntityId.entity('thread', number, slug)
  }

  static post(slug: string, number: number): string {
    return EntityId.entity('post', number, slug)
  }
}

