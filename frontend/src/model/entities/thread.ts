import type { Moderators, RoleOption } from '../rules/roles'
import type { Entity } from './entity'
import type { Identity } from './identity'

export interface Thread extends Entity {
  readonly moderation: Moderators
  readonly roles: RoleOption[]
  readonly number: number
  readonly board: string
  readonly topicHash: Uint8Array | null
  readonly closed: boolean
  readonly pinned: boolean
  readonly deleted: boolean
  readonly postCount: number
  readonly bump: bigint
  readonly lastPosts: number[]
  readonly admin: Identity | null
  readonly moderators: Identity[]
  readonly opId: string | null
  readonly replyIds: readonly string[]
  readonly title: string
  readonly topic: string
  readonly isPinned: boolean
  readonly opAdmin: boolean
  readonly skipped: number
}
