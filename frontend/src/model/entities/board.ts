import type { Moderators, RoleOption } from '../rules/roles'
import type { Entity } from './entity'
import type { Identity } from './identity'

export interface Board extends Entity {
  readonly moderation: Moderators
  readonly roles: RoleOption[]
  readonly description: string
  readonly next: number | null
  readonly slug: string
  readonly descriptionHash: Uint8Array | null
  readonly readonly: boolean
  readonly bumpLimit: number
  readonly maxMedia: number
  readonly threadCount: number
  readonly postCount: number
  readonly pinned: number[]
  readonly reactions: Uint8Array[]
  readonly moderators: Identity[]
  readonly ignoreForumBans: boolean
}
