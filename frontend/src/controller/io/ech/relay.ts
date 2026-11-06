import type { BcsType } from '@mysten/bcs'
import { bcs, toHex as hex, fromHex as unhex } from '@mysten/bcs'
import { blake2b } from '@noble/hashes/blake2'
export { toHex as hex, fromHex as unhex } from '@mysten/bcs'

import { SERVER_URL } from '../browser/relays'
import { Identity } from '../crypto/identity'
import {
  BoardEntitySchema,
  BoardPageSchema,
  ForumEntitySchema,
  ForumPageSchema,
  PostPageSchema,
  ThreadMetaSchema,
  ThreadPageSchema,
  type BoardPageEntity,
  type ForumPageEntity,
  type PostPageEntity,
  type ThreadPageEntity,
} from './protocol/entities'
import { EntityId } from './protocol/entityId'
import {
  ResourcesSchema,
  MediaMetaSchema,
  type Media,
  SignedSchema,
  UserPartSchema,
  type Call,
  type Esid,
  type Resources,
} from './protocol/transactions'

const CONTENT_TYPE = 'application/octet-stream'
const BASE = `${SERVER_URL}/api`

export type Relay = {
  base: string
  root: Uint8Array
  program: Uint8Array
}

export type Access = {
  tweak?: Uint8Array
  decrypt?: Esid[]
}

export function connectionInfo(base: string, value: unknown): Relay {
  if (!value || typeof value !== 'object' || !('root' in value) || !('program' in value)
    || typeof value.root !== 'string' || typeof value.program !== 'string') {
    throw new Error('Server did not provide root and program. Update ech-board-server.')
  }
  const root = unhex(value.root)
  const program = unhex(value.program)
  if (root.length !== 32 || program.length !== 32) throw new Error('Invalid relay connection info')
  return { base: base.replace(/\/$/, ''), root, program }
}

export async function connect(base = BASE): Promise<Relay> {
  base = base.replace(/\/$/, '')
  const response = await fetch(`${base}/root`)
  if (!response.ok) throw new Error(`${response.status} /root`)
  return connectionInfo(base, await response.json())
}

export function call(relay: Relay, functionName: string, args: Uint8Array): Call {
  return {
    program: { $kind: 'Txid' as const, Txid: relay.program },
    function: functionName,
    args,
  }
}

export async function submit(
  relay: Relay,
  identity: Identity,
  request: Call,
  access: Access,
  blobs: Uint8Array[] = [],
  onPrepared?: (txid: string) => void,
): Promise<{ txid: string; result: Uint8Array }> {
  const user = identity.sign(relay.root, new Uint8Array(), request, access.tweak)
  const txid = hex(blake2b(bcs.tuple([bcs.bytes(32), UserPartSchema]).serialize([relay.root, user]).toBytes(), { dkLen: 32 }))
  const payload = SignedSchema.serialize({ user, decryptions: access.decrypt ?? [] }).toBytes()
  const form = new FormData()
  form.append('signed', new Blob([payload.slice().buffer as ArrayBuffer], { type: CONTENT_TYPE }))
  for (const blob of blobs) {
    form.append('blob', new Blob([blob.slice().buffer as ArrayBuffer], { type: CONTENT_TYPE }))
  }
  onPrepared?.(txid)
  const response = await fetch(`${relay.base}/submit`, { method: 'POST', body: form })
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!response.ok) throw new Error(message(bytes))
  return { txid, result: bytes }
}

export async function query(
  relay: Relay,
  identity: Identity,
  request: Call,
  access: Access,
): Promise<Uint8Array> {
  const [first] = await queryBatch(relay, identity, [request], access)
  return first
}

async function post(relay: Relay, endpoint: string, payload: Uint8Array): Promise<Uint8Array> {
  const response = await fetch(`${relay.base}/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': CONTENT_TYPE },
    body: payload.slice().buffer,
  })
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!response.ok) throw new Error(message(bytes))
  return bytes
}

function message(bytes: Uint8Array): string {
  const text = new TextDecoder().decode(bytes)
  try {
    const parsed = JSON.parse(text) as { error?: string }
    if (parsed.error) return parsed.error
  } catch {
    return text
  }
  return text
}

async function read<T>(
  relay: Relay,
  identity: Identity,
  request: Call,
  access: Access,
  schema: BcsType<any, any, any>,
): Promise<Resources<T>> {
  const bytes = await query(relay, identity, request, access)
  return parseResources<T>(bytes, schema)
}

function parseResources<T>(bytes: Uint8Array, schema: BcsType<any, any, any>): Resources<T> {
  const parsed = ResourcesSchema(schema).parse(bytes)
  return {
    view: parsed.view as T,
    contents: new Map(
      Array.from(parsed.contents, ([hash, bytes]) => [hex(hash), bytes]),
    ),
    attachments: new Map(
      Array.from(parsed.attachments, ([hash, media]) => [hex(hash), media]),
    ),
  }
}

export async function queryBatch(
  relay: Relay,
  identity: Identity,
  requests: Call[],
  access: Access,
): Promise<Uint8Array[]> {
  const body = requests.map((request) => ({
    user: identity.sign(relay.root, new Uint8Array(), request, access.tweak),
    decryptions: access.decrypt ?? [],
  }))
  const payload = bcs.vector(SignedSchema).serialize(body).toBytes()
  const bytes = await post(relay, 'query', payload)
  return bcs.vector(bcs.byteVector()).parse(bytes)
}

export async function readMetadata(
  relay: Relay,
  identity: Identity,
  access: Access,
  board?: string,
  thread?: number,
) {
  const requests = [
    call(relay, 'forum.meta', unhex(EntityId.forum())),
    call(relay, 'forum.page', unhex(EntityId.forum())),
  ]
  if (board !== undefined) requests.push(call(relay, 'board.meta', unhex(EntityId.board(board))))
  if (board !== undefined && thread !== undefined) requests.push(call(relay, 'thread.meta', unhex(EntityId.thread(board, thread))))
  const results = await queryBatch(relay, identity, requests, access)
  return {
    forum: parseResources<typeof ForumEntitySchema.$inferType>(results[0], ForumEntitySchema),
    boards: parseResources<ForumPageEntity>(results[1], ForumPageSchema),
    board: results[2] ? parseResources<typeof BoardEntitySchema.$inferType>(results[2], BoardEntitySchema) : null,
    thread: results[3] ? parseResources<typeof ThreadMetaSchema.$inferType>(results[3], ThreadMetaSchema) : null,
  }
}

export function readBoard(
  relay: Relay,
  identity: Identity,
  id: string,
  before: number,
  access: Access,
): Promise<Resources<BoardPageEntity>> {
  const args = boardPageArgs(id, before)
  return read<BoardPageEntity>(
    relay,
    identity,
    call(relay, 'board.page', args),
    access,
    BoardPageSchema,
  )
}

export async function readThreadPages(
  relay: Relay,
  identity: Identity,
  id: string,
  cursors: number[],
  access: Access,
): Promise<Resources<ThreadPageEntity>[]> {
  if (cursors.length === 0) return []
  const requests = cursors.map((after) => call(relay, 'thread.page', threadPageArgs(id, after)))
  const results = await queryBatch(relay, identity, requests, access)
  return results.map((bytes) => parseResources<ThreadPageEntity>(bytes, ThreadPageSchema))
}

export function readPost(
  relay: Relay,
  identity: Identity,
  id: Uint8Array,
  access: Access,
): Promise<Resources<PostPageEntity>> {
  return read<PostPageEntity>(
    relay,
    identity,
    call(relay, 'post.get', id),
    access,
    PostPageSchema,
  )
}

function boardPageArgs(id: string, before: number): Uint8Array {
  return new Uint8Array([...unhex(id), ...u64(before)])
}

function threadPageArgs(id: string, after: number): Uint8Array {
  return new Uint8Array([...unhex(id), ...u64(after)])
}

export async function getContent(
  relay: Relay,
  hash: string,
): Promise<Uint8Array | null> {
  const response = await fetch(`${relay.base}/content/${hash}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(await response.text())
  return new Uint8Array(await response.arrayBuffer())
}

export async function getMediaMeta(relay: Relay, hash: string): Promise<Media | null> {
  const response = await fetch(`${relay.base}/media/${hash}/meta`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(await response.text())
  return MediaMetaSchema.parse(new Uint8Array(await response.arrayBuffer()))
}

export async function putContent(
  relay: Relay,
  bytes: Uint8Array,
): Promise<string> {
  return putBlob(relay, 'content', bytes)
}

export async function putMedia(
  relay: Relay,
  bytes: Uint8Array,
): Promise<string> {
  return putBlob(relay, 'media', bytes)
}

async function putBlob(
  relay: Relay,
  endpoint: string,
  bytes: Uint8Array,
): Promise<string> {
  const response = await fetch(`${relay.base}/${endpoint}`, {
    method: 'POST',
    body: bytes.slice().buffer,
  })
  if (!response.ok) throw new Error(await response.text())
  return hex(new Uint8Array(await response.arrayBuffer()))
}

export async function feed(
  relay: Relay,
  entity: string,
  before: string | null,
  limit: number,
): Promise<{
  entity: string
  entries: {
    txid: string
    timestamp_ms: number
    sender: string
    function: string
    args: string
    result: string
  }[]
  next: string | null
}> {
  const cursor = before === null ? '' : `&before=${before}`
  const response = await fetch(
    `${relay.base}/feed/${entity}?limit=${limit}${cursor}`,
  )
  if (!response.ok) throw new Error(await response.text())
  return response.json()
}

function u64(value: number): number[] {
  const out: number[] = []
  let rest = BigInt(value)
  for (let index = 0; index < 8; index += 1) {
    out.push(Number(rest & 0xffn))
    rest >>= 8n
  }
  return out
}
