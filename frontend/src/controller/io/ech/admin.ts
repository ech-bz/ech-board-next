import type { FeedEntry } from '../../../model/entities/event'
import { Calls, type ForumApi } from "./forumApi"
import { BanEntriesSchema, decodeEntity, type BanEntry, type EntityKind } from "./protocol/entities"
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(await response.text())
  return (await response.json()) as T
}
export interface FeedPage {
  entity: string
  entries: FeedEntry[]
  next: string | null
}
const FEED_LIMIT = 32
export async function fetchFeed(
  base: string,
  id: string,
  cursor?: string | null,
): Promise<FeedPage> {
  const hex = id.replace(/^0x/, "")
  const page = cursor ? `&before=${cursor}` : ""
  return request<FeedPage>(
    `${base.replace(/\/$/, "")}/api/feed/${hex}?limit=${FEED_LIMIT}${page}`,
  )
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
  if (!response.ok) throw new Error(await response.text())
  const bytes = new Uint8Array(await response.arrayBuffer())
  return { id, bytes, entity: decodeEntity(kind, bytes) }
}
