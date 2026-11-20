import type { EntityKind, EntityObject } from '../entities/entity'

export interface DialogState {
  topic: string | null
  moderators: { kind: 'forum' | 'board' | 'thread'; threadId?: string } | null
  banTarget: { postIds: string[]; threadId: string; deletePosts: boolean } | null
  bans: { title: string; kind: 'forum' | 'board' | 'thread'; id: string } | null
  boardSettings: boolean
  createBoard: string | null
  forumTitle: string | null
  logs: { tab: EntityKind; object: EntityObject | null } | null
  authorHistory: string | null
  transaction: string | null
  unbanTarget: { postId: string; threadId: string } | null
  grantTarget: { postId: string; threadId: string } | null
}

export const emptyDialogs = (): DialogState => ({ topic: null, moderators: null, banTarget: null, bans: null, boardSettings: false, createBoard: null, forumTitle: null, logs: null, authorHistory: null, transaction: null, unbanTarget: null, grantTarget: null })
