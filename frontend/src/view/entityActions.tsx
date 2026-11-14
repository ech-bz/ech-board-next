import { createContext, useContext, type Accessor, type JSX } from 'solid-js'
import type { EntityObject } from '../model/entities/entity'
import type { Post } from '../model/entities/post'
import { canBan, canBanAny, roleForThreadAction, type BanScope, type ThreadAction } from '../model/rules/permissions'
import { withThreadRoles, type RoleKind, type RoleOption } from '../model/rules/roles'
import { useForumController, useForumQueries } from './bindings/forum'
import { useMod } from './mod'
import { useModals, type ReportTarget } from './modals'

export type ThreadModAction = 'close' | 'open' | 'delete' | 'restore'

export interface EntityActions {
  runThreadAction: (action: ThreadModAction, threadId: string) => void
  runThreadCloseDelete: (threadId: string) => void
  runThreadEditTopic: (threadId: string, topic: string) => void
  runPostDelete: (post: Post, threadId: string, action: 'delete' | 'restore') => void
  runBan: (post: Post, threadId: string, scope: BanScope, mask: number, durationMs: number, reason: string) => void
  runUnban: (post: Post, threadId: string, scope: BanScope) => void
  runBanMedia: (post: Post, threadId: string, hashes: Uint8Array[]) => void
  runUnbanMedia: (post: Post, threadId: string, hashes: Uint8Array[]) => void
  roleKinds: Accessor<RoleKind[]>
  canThreadClose: (threadId: string) => boolean
  canThreadOpen: (threadId: string) => boolean
  canThreadDelete: (threadId: string) => boolean
  canThreadRestore: (threadId: string) => boolean
  canThreadEditTopic: (threadId: string) => boolean
  canThreadPin: (threadId: string) => boolean
  isThreadPinned: (threadId: string) => boolean
  toggleThreadPin: (threadId: string) => void
  threadTopic: (threadId: string) => string
  threadId: () => string | null
  selectedPosts: (ids: Set<string>) => Post[]
  deletedCount: (ids: Set<string>) => number
  openReport: (target: ReportTarget) => void
  openThreadTopic: (threadId: string) => void
  openThreadModerators: (threadId: string) => void
  openBoardModerators: () => void
  openForumModerators: () => void
  openBoardSettings: () => void
  openBan: (posts: Post[], threadId: string, deletePosts?: boolean) => void
  openBanId: () => void
  openBans: (title: string, kind: 'forum' | 'board' | 'thread', id: string) => void
  openLogs: (tab: 'forum' | 'board' | 'thread' | 'post', object?: EntityObject) => void
  canBanAny: Accessor<boolean>
  canBanScope: (scope: BanScope) => boolean
  busy: Accessor<boolean>
}

const EntityActionsContext = createContext<EntityActions>()

export function EntityActionsProvider(props: { roles: RoleOption[]; children: JSX.Element }) {
  const store = useForumController()
  const read = useForumQueries()
  const mod = useMod()
  const modals = useModals()
  const threadRoles = (threadId: string) => withThreadRoles(props.roles, read.rolesForThread(threadId))
  const canThread = (action: ThreadAction) => (threadId: string) => !!roleForThreadAction(action, threadRoles(threadId))
  const value: EntityActions = {
    runThreadAction: (action, threadId) => mod.runThreadAction(action, threadId),
    runThreadCloseDelete: (threadId) => mod.runThreadCloseDelete(threadId),
    runThreadEditTopic: (threadId, topic) => mod.runThreadEditTopic(threadId, topic),
    runPostDelete: (post, threadId, action) => mod.runPostDelete(post, action, threadId),
    runBan: (post, threadId, scope, mask, durationMs, reason) => mod.runBan(post, threadId, scope, mask, durationMs, reason),
    runUnban: (post, threadId, scope) => mod.runUnban(post, threadId, scope),
    runBanMedia: (post, threadId, hashes) => mod.runPostBanMedia(post, threadId, hashes),
    runUnbanMedia: (post, threadId, hashes) => mod.runPostUnbanMedia(post, threadId, hashes),
    roleKinds: () => props.roles.map((role) => role.kind),
    canThreadClose: canThread('close'),
    canThreadOpen: canThread('open'),
    canThreadDelete: canThread('delete'),
    canThreadRestore: canThread('restore'),
    canThreadEditTopic: canThread('edit_topic'),
    canThreadPin: (threadId) => !!roleForThreadAction('pin', threadRoles(threadId)),
    isThreadPinned: (threadId) => read.isThreadPinned(threadId),
    toggleThreadPin: (threadId) => { void store.toggleThreadPin(threadId) },
    threadTopic: (threadId) => read.threadTopic(threadId),
    threadId: () => read.threadId(),
    selectedPosts: (ids) => {
      const posts: Post[] = []
      for (const id of ids) {
        const record = read.get(id)
        if (record) posts.push(record)
      }
      return posts
    },
    deletedCount: (ids) => {
      let count = 0
      for (const id of ids) if (read.get(id)?.hidden) count++
      return count
    },
    openReport: (target) => modals.openReport(target),
    openThreadTopic: (threadId) => modals.openThreadTopic(threadId),
    openThreadModerators: (threadId) => modals.openThreadModerators(threadId),
    openBoardModerators: () => modals.openBoardModerators(),
    openForumModerators: () => modals.openForumModerators(),
    openBoardSettings: () => modals.openBoardSettings(),
    openBan: (posts, threadId, deletePosts) => modals.openBan(posts, threadId, deletePosts),
    openBanId: () => modals.openBanId(),
    openBans: (title, kind, id) => modals.openBans(title, kind, id),
    openLogs: (tab, object) => modals.openLogs(tab, object),
    canBanAny: () => canBanAny(props.roles.map((role) => role.kind)),
    canBanScope: (scope) => canBan(scope, props.roles.map((role) => role.kind)),
    busy: mod.busy,
  }
  return <EntityActionsContext.Provider value={value}>{props.children}</EntityActionsContext.Provider>
}

export function useEntityActions(): EntityActions {
  const value = useContext(EntityActionsContext)
  if (!value) throw new Error('useEntityActions outside provider')
  return value
}
