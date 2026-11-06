import type { PostPart } from '../content/postPart'
import type { PostRole } from '../rules/roles'
import type { Counter, Entity } from './entity'
import type { Identity } from './identity'
import type { MediaInfo } from './media'
import type { PostReference } from './postReference'
import type { ReactionInfo } from './reaction'

export interface Post extends Entity {
  readonly number: number
  readonly board: string
  readonly threadNumber: number
  readonly author: string
  readonly createdAt: number
  readonly textHash: Uint8Array | null
  readonly mediaHashes: Uint8Array[]
  readonly nameHash: Uint8Array | null
  readonly country: number
  readonly deleted: boolean
  readonly bannedMedia: Uint8Array[]
  readonly edited: boolean
  readonly multipleVotes: boolean
  readonly votes: Counter[]
  readonly reactionCounts: Counter[]
  readonly moderatorNoteHash: Uint8Array | null
  readonly bannedBy: Identity | null
  readonly threadId: string
  readonly relNum: number | null
  readonly op: boolean
  readonly name: string | null
  readonly tripText: string | null
  readonly tripSecured: boolean
  readonly flagUrl: string | null
  readonly hasText: boolean
  readonly parts: PostPart[] | null
  readonly plain: string
  readonly refs: readonly PostReference[]
  readonly refsRevision: number
  readonly media: readonly MediaInfo[]
  readonly reactions: readonly ReactionInfo[]
  readonly reactionGlyph: string | null
  readonly myReaction: string | null
  readonly myReactionBase: string | null
  readonly reactionPending: boolean
  readonly repliedMine: boolean
  readonly banned: boolean
  readonly bannedLevel: string | null
  readonly mine: boolean
  readonly role: PostRole
  readonly canEdit: boolean
  readonly canDelete: boolean
  readonly canRestore: boolean
  readonly canBanMedia: boolean
  readonly canUnbanMedia: boolean
  readonly deadline: number | null
  readonly hidden: boolean
}
