import { bcs, type BcsType } from '@mysten/bcs';

type Schema = { name?: string; fields?: Record<string, Schema> }

function struct<T extends Record<string, BcsType<any, any, any>>>(name: string, fields: T) {
  return Object.assign(bcs.struct(name, fields), { fields })
}

function enumeration<T extends Record<string, BcsType<any, any, any> | null>>(name: string, fields: T) {
  return Object.assign(bcs.enum(name, fields), { fields: fields as unknown as Record<string, Schema> })
}

import { EsidSchema, ProofSchema, UserPartSchema } from './transactions';

const Hash = bcs.bytes(32)
const bigMap = (name: string) => struct(name, {})

const ServerPartSchema = struct('ServerPart', {
  ctx: bcs.byteVector(),
  proof: ProofSchema,
})

const TxSchema = struct('Tx', {
  user: UserPartSchema,
  server: ServerPartSchema,
})

export type Tx = typeof TxSchema.$inferType

const BanValueSchema = struct('BanValue', {
  reason_hash: bcs.option(Hash),
  expires: bcs.u64(),
})

export const BanEntriesSchema = bcs.vector(bcs.tuple([EsidSchema, BanValueSchema]))
export type BanEntry = typeof BanEntriesSchema.$inferType[number]

const BansSchema = struct('Bans', {
  public: bigMap('BigMap<Esid, BanValue>'),
  private: bigMap('BigMap<Sid, Esid>'),
})

const PostKeySchema = struct('PostKey', {
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
  banned: bcs.option(EsidSchema),
  postcount: bcs.option(bcs.u64()),
  threadcount: bcs.option(bcs.u64()),
})

const ThreadKeySchema = struct('ThreadKey', {
  number: bcs.u64(),
  board: bcs.string(),
})

const ThreadV1Schema = struct('ThreadV1', {
  topic_hash: bcs.option(Hash),
  closed: bcs.bool(),
  pinned: bcs.bool(),
  deleted: bcs.bool(),
  post_count: bcs.u64(),
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
  moderators: bcs.vector(EsidSchema),
  bans: BansSchema,
  boards: struct('BigLog<BoardKey>', { entries: bigMap('BigMap<u64, BoardKey>'), length: bcs.u64() }),
})

const HistoryLog = struct('BigLog<[u8; 32]>', {
  entries: bigMap('BigMap<u64, [u8; 32]>'),
  length: bcs.u64().transform({ input: (value: bigint) => value, output: (value) => BigInt(value) }),
})

const entity = <K, V>(key: BcsType<K, any, any>, value: BcsType<V, any, any>) =>
  struct('Entity', { history: HistoryLog, genesis: TxSchema, key, value })

export const PostEntitySchema = entity(PostKeySchema, enumeration('Post', { V1: PostV1Schema }))
export const ThreadEntitySchema = entity(ThreadKeySchema, enumeration('Thread', { V1: ThreadV1Schema }))
export const BoardEntitySchema = entity(BoardKeySchema, enumeration('Board', { V1: BoardV1Schema }))
export const ForumEntitySchema = entity(ForumKeySchema, enumeration('Forum', { V1: ForumV1Schema }))

export const HistoryPageSchema = struct('HistoryPage', {
  entries: bcs.vector(TxSchema),
  next: bcs.option(bcs.u64().transform({ input: (value: bigint) => value, output: (value) => BigInt(value) })),
})
export type HistoryPage = typeof HistoryPageSchema.$inferType

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

const ServerContextSchema = struct('ServerContext', {
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

export const PostPageSchema = struct('PostPage', {
  post: PostEntitySchema,
  my_reactions: bcs.map(Hash, Hash),
})

export const ThreadPageSchema = struct('ThreadPage', {
  my_reactions: bcs.map(Hash, Hash),
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
