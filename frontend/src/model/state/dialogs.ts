import type { EntityKind, EntityObject } from '../entities/entity'

export interface DialogState {
  topic: string | null
  moderators: { kind: 'forum' | 'board' | 'thread'; threadId?: string } | null
  banTarget: { postIds: string[]; threadId: string; deletePosts: boolean } | null
  banId: boolean
  bans: { title: string; kind: 'forum' | 'board' | 'thread'; id: string } | null
  boardSettings: boolean
  createBoard: string | null
  forumTitle: string | null
  logs: { tab: EntityKind; object: EntityObject | null } | null
}

export const emptyDialogs = (): DialogState => ({ topic: null, moderators: null, banTarget: null, banId: false, bans: null, boardSettings: false, createBoard: null, forumTitle: null, logs: null })
