import type { EntityKind, EntityObject } from '../entities/entity'

export interface DialogState {
  topic: string | null
  moderators: { kind: 'forum' | 'board' | 'thread'; threadId?: string; forumId?: string } | null
  banTarget: { postIds: string[]; threadId: string; deletePosts: boolean } | null
  bans: { title: string; kind: 'forum' | 'board' | 'thread'; id: string; relayUrl?: string } | null
  boardSettings: boolean
  createBoard: { forumId: string } | null
  forumTitle: { forumId: string } | null
  logs: { tab: EntityKind; object: EntityObject | null; relayUrl?: string } | null
  authorHistory: string | null
  transaction: { txid: string; relayUrl?: string } | null
  unbanTarget: { postId: string; threadId: string } | null
  grantTarget: { postId: string; threadId: string } | null
}

export const emptyDialogs = (): DialogState => ({ topic: null, moderators: null, banTarget: null, bans: null, boardSettings: false, createBoard: null, forumTitle: null, logs: null, authorHistory: null, transaction: null, unbanTarget: null, grantTarget: null })
