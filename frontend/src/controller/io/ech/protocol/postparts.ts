import { bcs, BcsType } from '@mysten/bcs'
import type { PostPart as PostPartInput } from '../../../../model/content/postPart'
export type { PostPart as PostPartInput } from '../../../../model/content/postPart'

const Address = bcs.bytes(32)

function lazy<T>(cb: () => BcsType<T>): BcsType<T> {
  let cached: BcsType<T> | null = null
  return new BcsType<T>({
    name: 'lazy' as never,
    read: (r) => {
      if (!cached) cached = cb()
      return cached.read(r)
    },
    write: (v, w) => {
      if (!cached) cached = cb()
      cached.write(v, w)
    },
    serialize: (v, opts) => {
      if (!cached) cached = cb()
      return cached.serialize(v, opts).toBytes()
    },
    serializedSize: (v) => {
      if (!cached) cached = cb()
      return cached.serializedSize(v)
    },
  })
}

export const PostPart: BcsType<PostPartInput> = bcs.enum('PostPart', {
  Plain: bcs.string(),
  Bold: bcs.vector(lazy(() => PostPart as unknown as BcsType<PostPartInput>)),
  Italic: bcs.vector(lazy(() => PostPart as unknown as BcsType<PostPartInput>)),
  Code: bcs.vector(lazy(() => PostPart as unknown as BcsType<PostPartInput>)),
  ReplyTo: bcs.struct('ReplyTo', {
    forum: Address,
    board: bcs.string(),
    post: bcs.u64().transform({ input: (value: number) => value, output: (value) => Number(value) }),
  }),
  Secret: bcs.struct('Secret', {
    data_nonce: bcs.bytes(12),
    data_ct: bcs.vector(bcs.u8()),
    encrypted_keys: bcs.vector(bcs.struct('EncryptedKey', {
      nonce: bcs.bytes(12),
      ct: bcs.bytes(32),
      tag: bcs.bytes(16),
    })),
  }),
  Underline: bcs.vector(lazy(() => PostPart as unknown as BcsType<PostPartInput>)),
  Overline: bcs.vector(lazy(() => PostPart as unknown as BcsType<PostPartInput>)),
  Spoiler: bcs.vector(lazy(() => PostPart as unknown as BcsType<PostPartInput>)),
  Strike: bcs.vector(lazy(() => PostPart as unknown as BcsType<PostPartInput>)),
  Sup: bcs.vector(lazy(() => PostPart as unknown as BcsType<PostPartInput>)),
  Sub: bcs.vector(lazy(() => PostPart as unknown as BcsType<PostPartInput>)),
  Link: bcs.struct('Link', {
    url: bcs.string(),
    children: bcs.vector(lazy(() => PostPart as unknown as BcsType<PostPartInput>)),
  }),
  Fold: bcs.struct('Fold', {
    title: bcs.string(),
    children: bcs.vector(lazy(() => PostPart as unknown as BcsType<PostPartInput>)),
  }),
}) as unknown as BcsType<PostPartInput>

export const PostPartVec = bcs.vector(PostPart)

export function serializePostParts(parts: PostPartInput[]): Uint8Array {
  return PostPartVec.serialize(parts).toBytes()
}
