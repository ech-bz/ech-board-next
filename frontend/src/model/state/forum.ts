import type { PostPart } from '../content/postPart'
import type { Board, BoardCursor } from '../entities/board'
import type { Forum } from '../entities/forum'
import type { Media } from '../entities/media'
import type { Post } from '../entities/post'
import type { PostReferences } from '../entities/postReference'
import type { Thread } from '../entities/thread'
import { emptyDraft, type ComposerDraft } from './composer'
import { emptyDialogs, type DialogState } from './dialogs'
import type { NavigationState } from './navigation'
import type { OperationsState } from './operations'
import { initialPreferences, type Preferences } from './preferences'
import type { ResourceState } from './resources'
import type { PostLifetime } from './retention'
import type { RelayDescriptor, SessionState } from './session'
import type { ThreadPosts } from './threadPosts'
import { emptyUnread, type UnreadState } from './unread'

export interface ReactionSelection {
  seq: bigint
  value: string | null
}

export interface PendingReaction {
  txid: string
  local: string | null
  base: string | null
}

export interface ForumScope {
  root: string
  relayUrl: string
  entities: {
    posts: Record<string, Post>
    threads: Record<string, Thread>
    boards: Record<string, Board>
    forums: Record<string, Forum>
  }
  contents: Record<string, Uint8Array>
  parts: Record<string, PostPart[]>
  attachments: Record<string, Media>
  postIds: Record<string, string>
  threadIds: Record<string, string>
  boardIds: Record<string, string>
  threadPosts: Record<string, ThreadPosts>
  postLifetime: PostLifetime
  contentPosts: Record<string, Record<string, true>>
  attachmentPosts: Record<string, Record<string, true>>
  ownedAuthorIds: string[]
  permissionDeadlines: Record<string, { at: number; previous: string | null; next: string | null }>
  permissionHead: string | null
  permissionTail: string | null
  authors: Record<string, { mine: boolean; tweak: Uint8Array }>
  boardPages: Record<string, { threadIds: string[]; next: BoardCursor | null }>
  loadedThreads: Record<string, boolean>
  myReactions: Record<string, ReactionSelection>
  pendingReactions: Record<string, PendingReaction>
}

export interface PostPreview {
  id: number
  forumId: string
  postId: string
  dependencies: string[]
  active: boolean
  error: boolean
}

export interface ForumState {
  realtime: { phase: 'idle' | 'loading' | 'live' | 'disconnected'; events: string[] }
  dialogs: DialogState
  selection: { ids: string[]; lastId: string | null }
  gallery: { forumId: string; postId: string; hash: string } | null
  unread: UnreadState
  session: SessionState
  relays: Record<string, RelayDescriptor>
  preferences: Preferences
  drafts: Record<'reply' | 'thread', ComposerDraft>
  operations: OperationsState
  resources: ResourceState
  notifications: { id: number; message: string }[]
  navigation: NavigationState
  scopes: Record<string, ForumScope>
  references: Record<string, PostReferences>
  outgoing: Record<string, string[]>
  previews: Record<number, PostPreview>
  page: {
    revision: number
    forumId: string | null
    boardId: string | null
    threadId: string | null
    mode: 'thread' | 'board' | null
    loadingMore: boolean
    resyncSequence: number
  }
}

export function initialForumState(): ForumState {
  return {
    realtime: { phase: 'idle', events: [] },
    dialogs: emptyDialogs(),
    selection: { ids: [], lastId: null },
    gallery: null,
    unread: emptyUnread(),
    session: { master: '' },
    relays: {},
    preferences: initialPreferences(),
    drafts: { reply: emptyDraft('reply'), thread: emptyDraft('thread') },
    operations: { posting: false, uploadProgress: null, moderating: false, reacting: {}, selectionProgress: null },
    resources: { bans: {}, feeds: {}, snapshots: {}, secrets: {}, reactions: {} },
    notifications: [],
    navigation: { defaultForumId: null, route: null, lastContentRoute: null, context: null, forums: [], loading: true, refreshing: false, reconnecting: false, error: null, collapsed: false },
    scopes: {},
    references: {},
    outgoing: {},
    previews: {},
    page: { revision: 0, forumId: null, boardId: null, threadId: null, mode: null, loadingMore: false, resyncSequence: 0 },
  }
}

export function initialForumScope(root: string, relayUrl: string): ForumScope {
  return {
    root,
    relayUrl,
    entities: { posts: {}, threads: {}, boards: {}, forums: {} },
    contents: {},
    parts: {},
    attachments: {},
    postIds: {},
    threadIds: {},
    boardIds: {},
    threadPosts: {},
    postLifetime: { retained: {}, temporary: {} },
    contentPosts: {},
    attachmentPosts: {},
    authors: {},
    ownedAuthorIds: [],
    permissionDeadlines: {},
    permissionHead: null,
    permissionTail: null,
    boardPages: {},
    loadedThreads: {},
    myReactions: {},
    pendingReactions: {},
  }
}
