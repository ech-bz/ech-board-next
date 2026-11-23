import { bcs, type BcsType } from '@mysten/bcs';

type Schema = { name?: string; fields?: Record<string, Schema> }

function struct<T extends Record<string, BcsType<any, any, any>>>(name: string, fields: T) {
  return Object.assign(bcs.struct(name, fields), { fields })
}

function enumeration<T extends Record<string, BcsType<any, any, any> | null>>(name: string, fields: T) {
  return Object.assign(bcs.enum(name, fields), { fields: fields as unknown as Record<string, Schema> })
}

import { EsidSchema, ProofSchema, TxSchema, type Tx, UserPartSchema } from './transactions';

const Hash = bcs.bytes(32)
const bigMap = (name: string) => struct(name, {})

export { TxSchema }
export type { Tx }

const BanSchema = struct('Ban', {
  target: Hash,
  reason_hash: bcs.option(Hash),
  expires: bcs.option(bcs.u64()),
})

export type BanValue = typeof BanSchema.$inferType

export const BanEntriesSchema = bcs.vector(BanSchema)

const BansSchema = struct('Bans', {
  records: bigMap('BigMap<Sid, Vec<Ban>>'),
  targets: bigMap('BigMap<[u8; 32], Sid>'),
})

export const PostKeySchema = struct('PostKey', {
  number: bcs.u64(),
  board: bcs.string(),
})

const PostV1Schema = struct('PostV1', {
  thread: bcs.u64(),
  text_hash: bcs.option(Hash),
  media_hashes: bcs.vector(Hash),
  name_hash: bcs.option(Hash),
  deleted: bcs.bool(),
  banned_media: bcs.vector(Hash),
  edited: bcs.bool(),
  multi_vote: bcs.bool(),
  votes: bcs.vector(bcs.tuple([Hash, bcs.u64()])),
  reactions: bcs.vector(bcs.tuple([Hash, bcs.u64()])),
  voted: bigMap('BigMap<Sid, Vec<Hash>>'),
  reacted: bigMap('BigMap<Sid, Hash>'),
  mod_note_hash: bcs.option(Hash),
  postcount: bcs.option(bcs.u64()),
  threadcount: bcs.option(bcs.u64()),
})

export const ThreadKeySchema = struct('ThreadKey', {
  number: bcs.u64(),
  board: bcs.string(),
})

const ThreadV1Schema = struct('ThreadV1', {
  topic_hash: bcs.option(Hash),
  closed: bcs.bool(),
  pinned: bcs.bool(),
  deleted: bcs.bool(),
  post_count: bcs.u64(),
  deleted_count: bcs.u64(),
  bump: bcs.u64(),
  last_posts: bcs.vector(bcs.u64()),
  admin: bcs.option(EsidSchema),
  moderators: bcs.vector(EsidSchema),
  posts: bigMap('BigMap<u64, u64>'),
  bans: BansSchema,
})

const BoardKeySchema = struct('BoardKey', {
  slug: bcs.string(),
})

const BoardV1Schema = struct('BoardV1', {
  description_hash: bcs.option(Hash),
  readonly: bcs.bool(),
  bump_limit: bcs.u32(),
  max_media: bcs.u8(),
  post_rate_limit_ms: bcs.u32(),
  reaction_rate_limit_ms: bcs.u32(),
  pow_bits: bcs.u8(),
  thread_count: bcs.u64(),
  post_count: bcs.u64(),
  pinned: bcs.vector(bcs.u64()),
  reactions: bcs.vector(Hash),
  moderators: bcs.vector(EsidSchema),
  ignore_forum_bans: bcs.bool(),
  order: struct('BoardIndex', { root: bcs.u64(), next_node: bcs.u64() }),
  bans: BansSchema,
})

const ForumKeySchema = struct('ForumKey', {})

const ForumV1Schema = struct('ForumV1', {
  title_hash: bcs.option(Hash),
  pow_bits: bcs.u8(),
  moderators: bcs.vector(EsidSchema),
  bans: BansSchema,
  boards: struct('BigLog<BoardKey>', { entries: bigMap('BigMap<u64, BoardKey>'), length: bcs.u64() }),
})

const HistoryLog = struct('BigLog<[u8; 32]>', {
  entries: bigMap('BigMap<u64, [u8; 32]>'),
  length: bcs.u64().transform({ input: (value: bigint) => value, output: (value) => BigInt(value) }),
})

const entity = <K, V>(key: BcsType<K, any, any>, value: BcsType<V, any, any>) =>
  struct('Entity', { history: HistoryLog, genesis: Hash, key, value })

export const PostEntitySchema = entity(PostKeySchema, enumeration('Post', { V1: PostV1Schema }))
export const ThreadEntitySchema = entity(ThreadKeySchema, enumeration('Thread', { V1: ThreadV1Schema }))
export const BoardEntitySchema = entity(BoardKeySchema, enumeration('Board', { V1: BoardV1Schema }))
export const ForumEntitySchema = entity(ForumKeySchema, enumeration('Forum', { V1: ForumV1Schema }))

const UserV1Schema = struct('UserV1', {
  post_count: bcs.u64(),
  thread_count: bcs.u64(),
  last_post: bcs.u64(),
  last_reaction: bcs.u64(),
})

export const UserEntitySchema = entity(bcs.bytes(32), enumeration('User', { V1: UserV1Schema }))
export type UserEntity = typeof UserEntitySchema.$inferType

export const HistoryPageSchema = struct('HistoryPage', {
  entries: bcs.vector(TxSchema),
  next: bcs.option(bcs.u64().transform({ input: (value: bigint) => value, output: (value) => BigInt(value) })),
  length: bcs.u64().transform({ input: (value: bigint) => value, output: (value) => BigInt(value) }),
})
export type HistoryPage = typeof HistoryPageSchema.$inferType

export const AuthorHistoryPageSchema = struct('AuthorHistoryPage', {
  entries: bcs.vector(TxSchema),
  next: bcs.option(Hash),
  length: bcs.option(bcs.u64().transform({ input: (value: bigint) => value, output: (value) => BigInt(value) })),
})

const schemas = {
  post: PostEntitySchema,
  thread: ThreadEntitySchema,
  board: BoardEntitySchema,
  forum: ForumEntitySchema,
}

export type EntityKind = keyof typeof schemas

export function parseEntity<K extends EntityKind>(
  kind: K,
  bytes: Uint8Array,
): (typeof schemas)[K]['$inferType'] {
  return schemas[kind].parse(bytes) as (typeof schemas)[K]['$inferType']
}

export function decodeEntity(kind: EntityKind, bytes: Uint8Array): unknown {
  return describeEntity(kind, schemas[kind].parse(bytes))
}

function describeEntity(kind: EntityKind, value: unknown): unknown {
  return describe(schemas[kind] as unknown as Schema, value)
}

function describe(schema: Schema | undefined, value: unknown): unknown {
  if (schema?.name?.startsWith('BigMap<')) return schema.name
  if (value === null || typeof value !== 'object' || value instanceof Uint8Array) return value
  if (Array.isArray(value)) return value.map((item) => describe(schema, item))
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    out[key] = describe(schema?.fields?.[key], (value as Record<string, unknown>)[key])
  }
  return out
}

export const TripcodeSchema = struct('Tripcode', {
  secured: bcs.bool(),
  value: bcs.string(),
})

export const UserRequestsSchema = struct('UserRequests', {
  geo: bcs.bool(),
  trip: bcs.bool(),
  postcount: bcs.bool(),
})

export type UserRequests = typeof UserRequestsSchema.$inferType

export const ServerContextSchema = struct('ServerContext', {
  time: bcs.u64(),
  country: bcs.option(bcs.u32()),
  trip: bcs.option(TripcodeSchema),
})

export type ServerContextView = {
  time: number
  country: number | null
  trip: { secured: boolean; value: string } | null
}

export function parseServerContext(bytes: Uint8Array): ServerContextView {
  const context = ServerContextSchema.parse(bytes)
  return {
    time: Number(context.time),
    country: context.country,
    trip: context.trip,
  }
}

export const ThreadMetaSchema = struct('ThreadMeta', {
  thread: ThreadEntitySchema,
  page_size: bcs.u64(),
})

export const BanScopeSchema = bcs.enum('BanScope', {
  Thread: null,
  Board: null,
  Forum: null,
})

export type BanScopeValue = typeof BanScopeSchema.$inferType

export const BanMapSchema = bcs.map(BanScopeSchema, bcs.vector(Hash))

export type BanMapValue = typeof BanMapSchema.$inferType

export const PostPageSchema = struct('PostPage', {
  post: PostEntitySchema,
  my_reactions: bcs.map(Hash, Hash),
  bans: BanMapSchema,
})

export const ThreadPageSchema = struct('ThreadPage', {
  my_reactions: bcs.map(Hash, Hash),
  bans: BanMapSchema,
  posts: bcs.map(bcs.u64(), PostEntitySchema),
  next: bcs.option(bcs.u64()),
})

export const ThreadPreviewSchema = struct('ThreadPreview', {
  thread: ThreadEntitySchema,
  posts: bcs.map(bcs.u64(), PostEntitySchema),
})

export const BoardCursorSchema = struct('BoardCursor', {
  root: bcs.u64(),
  before: struct('BoardOrderKey', {
    bump: bcs.u64(),
    thread: bcs.u64(),
  }),
  pinned: bcs.vector(bcs.u64()),
})

export const BoardPageSchema = struct('BoardPage', {
  my_reactions: bcs.map(Hash, Hash),
  bans: BanMapSchema,
  threads: bcs.vector(ThreadPreviewSchema),
  next: bcs.option(BoardCursorSchema),
})

export const ForumPageSchema = struct('ForumPage', {
  boards: bcs.vector(BoardEntitySchema),
})

export type PostEntity = typeof PostEntitySchema.$inferType
export type ThreadEntity = typeof ThreadEntitySchema.$inferType
export type BoardEntity = typeof BoardEntitySchema.$inferType
export type ForumEntity = typeof ForumEntitySchema.$inferType
export type ThreadMetaEntity = typeof ThreadMetaSchema.$inferType
export type ThreadPageEntity = typeof ThreadPageSchema.$inferType
export type ThreadPreviewEntity = typeof ThreadPreviewSchema.$inferType
export type BoardPageEntity = typeof BoardPageSchema.$inferType
export type ForumPageEntity = typeof ForumPageSchema.$inferType

export type PostPageEntity = typeof PostPageSchema.$inferType
