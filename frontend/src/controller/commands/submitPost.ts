import { blake2b } from '@noble/hashes/blake2'
import type { RoleOption } from '../../model/rules/roles'
import type { ComposerDraft } from '../../model/state/composer'
import type { ForumState } from '../../model/state/forum'
import { finalizeParts, parseBbCode } from '../content/bbcode'
import { makePostResolver } from '../content/postResolver'
import type { ForumGateway } from '../forumGateway'
import { Calls } from '../io/ech/forumApi'
import { randomTweak } from '../io/crypto/identity'
import { serializePostParts } from '../io/ech/protocol/types'
import * as relayApi from '../io/ech/relay'
import type { EntityUpdate } from '../state/entities.types'

const text = new TextEncoder()

function postTweak(role?: RoleOption): Uint8Array {
  return role?.tweak ?? randomTweak()
}

export interface PostSubmitCtx {
  gateway: ForumGateway
  model: ForumState
  receive: (changes: EntityUpdate) => void
  forumId: string
  relayUrl: string
  boardId: string
  slug: string
  role?: RoleOption
}

export interface PostFormState {
  text: string
  name: string
  withFlag: boolean
  files: File[]
  stripExif: boolean
  selfAdmin?: boolean
}

export function composerForm(draft: ComposerDraft): PostFormState {
  return { text: draft.text, name: draft.name, withFlag: draft.withFlag, files: draft.files.slice(), stripExif: draft.stripExifOn, selfAdmin: draft.selfAdmin }
}

export type Progress = (loaded: number, total: number) => void

async function uploadAll(files: File[], onProgress: Progress): Promise<{ hashes: string[]; blobs: Uint8Array[] }> {
  const hashes: string[] = []
  const blobs: Uint8Array[] = []
  let loaded = 0
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    hashes.push(relayApi.hex(blake2b(bytes, { dkLen: 32 })))
    blobs.push(bytes)
    loaded += 1
    onProgress(loaded, files.length)
  }
  return { hashes, blobs }
}

function textBlob(value: string): { hash: string; blob: Uint8Array } | null {
  if (!value.trim()) return null
  const bytes = text.encode(value)
  return { hash: relayApi.hex(blake2b(bytes, { dkLen: 32 })), blob: bytes }
}

async function prepare(
  ctx: PostSubmitCtx,
  form: PostFormState,
  onProgress: Progress,
  tweak: Uint8Array,
): Promise<{ textHash: string | null; media: string[]; nameHash: string | null; blobs: Uint8Array[] }> {
  const api = await ctx.gateway.connect(ctx.relayUrl)
  const parsed = await parseBbCode(
    form.text,
    makePostResolver({
      gateway: ctx.gateway,
      model: ctx.model,
      forumId: ctx.forumId,
      boardId: ctx.boardId,
      slug: ctx.slug,
      relayUrl: ctx.relayUrl,
      receive: ctx.receive,
    }),
  )
  const secret = api.identity.secret(api.root, tweak)
  const parts = await finalizeParts(parsed, secret)
  const blobs: Uint8Array[] = []
  let hash: string | null = null
  if (parts.length > 0) {
    const blob = serialize(parts)
    blobs.push(blob)
    hash = relayApi.hex(blake2b(blob, { dkLen: 32 }))
  }
  const media = await uploadAll(form.files, onProgress)
  blobs.push(...media.blobs)
  const name = textBlob(form.name)
  if (name) blobs.push(name.blob)
  return { textHash: hash, media: media.hashes, nameHash: name ? name.hash : null, blobs }
}

function serialize(parts: unknown): Uint8Array {
  return serializePostParts(parts as never)
}

function u64(result: Uint8Array): number {
  let value = 0n
  for (let index = 7; index >= 0; index -= 1) value = (value << 8n) | BigInt(result[index])
  return Number(value)
}

export async function submitNewThread(
  ctx: PostSubmitCtx,
  form: PostFormState,
  subject: string,
  onProgress: Progress,
  _signal?: AbortSignal,
): Promise<{ thread: number } | null> {
  const tweak = postTweak(ctx.role)
  const { textHash: hash, media, nameHash, blobs } = await prepare(ctx, form, onProgress, tweak)
  const api = await ctx.gateway.connect(ctx.relayUrl)
  const topic = textBlob(subject)
  if (topic) blobs.push(topic.blob)
  const result = await api.append(
    Calls.board.create_thread(ctx.boardId, topic ? topic.hash : null, hash, media, nameHash, [], false, !!form.selfAdmin),
    blobs.map((bytes) => ({ hash: '', bytes })),
    tweak,
  )
  return { thread: u64(result.result) }
}

export async function submitReply(
  ctx: PostSubmitCtx & { threadId: string; threadNumber: number },
  form: PostFormState,
  onProgress: Progress,
  _signal?: AbortSignal,
): Promise<{ post: number } | null> {
  const tweak = postTweak(ctx.role)
  const { textHash: hash, media, nameHash, blobs } = await prepare(ctx, form, onProgress, tweak)
  const api = await ctx.gateway.connect(ctx.relayUrl)
  const result = await api.append(
    Calls.board.create_post(ctx.boardId, ctx.threadNumber, hash, media, nameHash, [], false),
    blobs.map((bytes) => ({ hash: '', bytes })),
    tweak,
  )
  return { post: u64(result.result) }
}
