import type { Moderators } from '../rules/roles'

export interface StaticInfo {
  relayUrl: string
  forumId: string
  forumEntityId: string
  boardId: string
  moderators: Moderators
  boardReactions: Uint8Array[]
}
