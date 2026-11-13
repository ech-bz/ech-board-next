import { responseError } from './errors'
import type { EntityKind, Tx } from "./protocol/entities"
import { AuthorHistoryPageSchema, HistoryPageSchema } from "./protocol/entities"
import { toHex } from '../../../model/content/hex'
import type { HistoryKind } from '../../../model/state/inspection'
import { Calls, type ForumApi } from "./forumApi"
import { BanEntriesSchema, decodeEntity, type BanEntry } from "./protocol/entities"
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) throw await responseError(response)
  return (await response.json()) as T
}
const HISTORY_LIMIT = 64
export async function fetchHistory(
  base: string,
  kind: HistoryKind,
  id: string,
  cursor?: string | null,
): Promise<{ entries: Tx[]; next: string | null; length: bigint | null }> {
  const hex = id.replace(/^0x/, "")
  if (kind === 'author') {
    const page = cursor ? `&from=${encodeURIComponent(cursor)}` : ''
    const response = await fetch(
      `${base.replace(/\/$/, '')}/api/history/author/${encodeURIComponent(hex)}?limit=32${page}`,
    )
    if (!response.ok) throw await responseError(response)
    const result = AuthorHistoryPageSchema.parse(new Uint8Array(await response.arrayBuffer()))
    return { entries: result.entries, next: result.next === null ? null : toHex(result.next).replace(/^0x/, ''), length: result.length }
  }
  const page = cursor ? `&before=${cursor}` : ""
  const response = await fetch(
    `${base.replace(/\/$/, "")}/api/debug/history/${kind}/${hex}?limit=${HISTORY_LIMIT}${page}`,
  )
  if (!response.ok) throw await responseError(response)
  const result = HistoryPageSchema.parse(new Uint8Array(await response.arrayBuffer()))
  return { entries: result.entries, next: result.next === null ? null : result.next.toString(), length: result.length }
}
export async function fetchBans(
  api: ForumApi,
  kind: "forum" | "board" | "thread",
  id: string,
): Promise<BanEntry[]> {
  const call =
    kind === "thread"
      ? Calls.thread.ban_list(id, null, 50)
      : kind === "board"
        ? Calls.board.ban_list(id, null, 50)
        : Calls.forum.ban_list(null, 50)
  const bytes = await api.query(call)
  return BanEntriesSchema.parse(bytes)
}

export interface EntitySnapshot {
  id: string
  bytes: Uint8Array
  entity: unknown
}

export async function fetchEntitySnapshot(base: string, kind: EntityKind, entityId: string): Promise<EntitySnapshot> {
  const id = entityId.replace(/^0x/, "")
  const response = await fetch(`${base.replace(/\/$/, "")}/api/debug/entity/${kind}/${id}`)
  if (!response.ok) throw await responseError(response)
  const bytes = new Uint8Array(await response.arrayBuffer())
  return { id, bytes, entity: decodeEntity(kind, bytes) }
}
