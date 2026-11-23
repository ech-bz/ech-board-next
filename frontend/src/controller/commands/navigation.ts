import { currentBoard, currentScope, forumKey } from '../../model/selectors/forum'
import { toHex } from '../../model/content/hex'
import { findForum } from '../../model/selectors/navigation'
import type { ForumState } from '../../model/state/forum'
import type { ForumInfo, Route } from '../../model/state/navigation'
import type { Commit } from '../commit'
import { failure } from '../errors'
import type { ForumGateway } from '../forumGateway'
import { boardChanges, forumChanges, pageReplacement, threadChanges } from '../ingestion/pages'
import type { Receive } from '../ingestion/receive'
import { saveCollapsedForums, saveSidebarCollapsed } from '../io/browser/preferences'
import { saveForums } from '../io/browser/relays'
import { relayEndpoint } from '../io/ech/resolve'
import { EntityId } from '../io/ech/protocol/entityId'
import type { Realtime } from '../synchronization/realtime'

export function createNavigation(model: ForumState, commit: Commit, gateway: ForumGateway, receive: Receive, ready: Promise<void>, realtime: Realtime, isDisposed: () => boolean, notify: (error: unknown) => void) {
  let generation = 0
  let routeKey: string | null = null
  const navigate = async (route: Route, background = false): Promise<Route | null> => {
    await ready
    if (isDisposed()) return null
    if ('slug' in route) commit({ type: 'navigation.patch', value: { lastContentRoute: route } })
    const target = 'forumId' in route
      ? findForum(model, route.forumId)
      : (model.navigation.context ? findForum(model, model.navigation.context.forumId) : null) ?? (model.navigation.defaultForumId ? findForum(model, model.navigation.defaultForumId) : null) ?? model.navigation.forums[0] ?? null
    if ('forumId' in route && !target) { commit({ type: 'navigation.patch', value: { loading: false, error: 'Forum relay is unavailable' } }); return null }
    const context = target ? { forumId: forumKey(target.forumId), relayUrl: await relayEndpoint(target.relayUrl) } : null
    if (route.page === 'boards' || route.page === 'settings') {
      routeKey = null
      realtime.close()
      const page: ForumState['page'] = { revision: model.page.revision + 1, forumId: context?.forumId ?? null, boardId: null, threadId: null, mode: null, loadingMore: false, resyncSequence: model.page.resyncSequence }
      commit(...pageReplacement(model, page), { type: 'navigation.patch', value: { route, context, error: null, loading: false, refreshing: false, reconnecting: false } })
      return null
    }
    if (!context) { commit({ type: 'navigation.patch', value: { loading: false, error: 'Forum relay is unavailable' } }); return null }
    const key = route.page === 'thread' ? `${context.forumId}/${route.slug}/${route.threadNum}` : `${context.forumId}/${route.slug}/${route.page}`
    if (routeKey === key && !model.navigation.error) { commit({ type: 'navigation.patch', value: { route } }); return null }
    routeKey = key
    const request = ++generation
    realtime.close()
    const page: ForumState['page'] = { revision: model.page.revision + 1, forumId: context.forumId, boardId: null, threadId: null, mode: null, loadingMore: false, resyncSequence: model.page.resyncSequence + Number(background) }
    const refresh = background && model.page.forumId === context.forumId
    commit({ type: 'navigation.patch', value: { route, context, error: null, loading: !refresh, refreshing: refresh } })
    try {
      const subscription = route.page === 'thread'
        ? { kind: 'thread' as const, id: EntityId.thread(route.slug, route.threadNum) }
        : { kind: 'board' as const, id: EntityId.board(route.slug) }
      const revision = await realtime.begin(context.relayUrl, subscription)
      if (isDisposed() || request !== generation) return null
      if (route.page === 'thread') {
        const data = await gateway.readThread(context.relayUrl, route.slug, route.threadNum)
        if (isDisposed() || request !== generation) return null
        await realtime.finish(revision, threadChanges(data), { ...page, boardId: EntityId.board(route.slug), threadId: data.threadId, mode: 'thread' })
      } else {
        const data = await gateway.readBoard(context.relayUrl, route.slug)
        if (isDisposed() || request !== generation) return null
        await realtime.finish(revision, boardChanges(data), { ...page, boardId: data.boardId, mode: 'board' })
      }
    } catch (error) {
      if (request === generation && !isDisposed()) {
        routeKey = null
        if (model.realtime.phase !== 'disconnected') realtime.close()
        commit({ type: 'navigation.patch', value: { error: failure(error), loading: false, refreshing: false } })
      }
    }
    return null
  }
  const loadForum = async (forum: ForumInfo): Promise<void> => {
    try {
      const data = await gateway.readForum(await relayEndpoint(forum.relayUrl))
      if (isDisposed()) return
      receive(forumChanges(data), { type: 'forum.error', value: { forumId: forum.forumId, error: null } })
    } catch (error) {
      if (isDisposed()) return
      commit({ type: 'forum.error', value: { forumId: forum.forumId, error: failure(error) } })
    }
  }
  return {
    navigate,
    async loadForums() {
      await ready
      await Promise.all(model.navigation.forums.map((forum) => loadForum(forum)))
    },
    async retryForum(forumId: string) {
      const forum = model.navigation.forums.find((item) => item.forumId === forumId)
      if (forum) await loadForum(forum)
    },
    async addRelay(value: string) {
      try {
        const trimmed = value.trim().replace(/\/+$/, '')
        if (!trimmed) return
        const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
        const api = await gateway.connect(url)
        const forumId = forumKey(toHex(api.root))
        const known = model.navigation.forums.some((forum) => forum.forumId === forumId)
        const forums = known ? model.navigation.forums : [...model.navigation.forums, { forumId, relayUrl: url }]
        commit({ type: 'navigation.patch', value: { forums } })
        saveForums(forums)
        await ready
        await loadForum({ forumId, relayUrl: url })
      } catch (error) {
        notify(error)
      }
    },
    toggleSidebar() {
      const collapsed = !model.navigation.collapsed
      commit({ type: 'navigation.patch', value: { collapsed } })
      saveSidebarCollapsed(collapsed)
    },
    toggleForum(forumId: string) {
      const key = forumKey(forumId)
      const collapsedForums = model.navigation.collapsedForums.includes(key)
        ? model.navigation.collapsedForums.filter((id) => id !== key)
        : [...model.navigation.collapsedForums, key]
      commit({ type: 'navigation.patch', value: { collapsedForums } })
      saveCollapsedForums(collapsedForums)
    },
    async removeRelay(forumId: string) {
      const key = forumKey(forumId)
      if (key === model.navigation.defaultForumId) return
      if (!model.navigation.forums.some((forum) => forum.forumId === key)) return
      const route = model.navigation.route
      if (route && 'forumId' in route && forumKey(route.forumId) === key) await navigate({ page: 'boards' })
      const forums = model.navigation.forums.filter((forum) => forum.forumId !== key)
      const collapsedForums = model.navigation.collapsedForums.filter((id) => id !== key)
      const fallback = forums.find((forum) => forum.forumId === model.navigation.defaultForumId) ?? forums[0] ?? null
      const current = model.navigation.context?.forumId === key
      const context = current ? (fallback ? { forumId: fallback.forumId, relayUrl: fallback.relayUrl } : null) : undefined
      commit({ type: 'navigation.patch', value: { forums, collapsedForums, ...(context === undefined ? {} : { context }) } })
      saveForums(forums)
      saveCollapsedForums(collapsedForums)
    },
    async loadMoreThreads() {
      const scope = currentScope(model), board = currentBoard(model)
      const feed = scope && board ? scope.boardPages[board.id] : null
      if (!scope || !board || feed?.next == null || model.page.loadingMore) return
      const request = generation
      commit({ type: 'page.patch', value: { loadingMore: true } })
      try {
        const data = await gateway.readBoard(scope.relayUrl, board.slug, feed.next)
        if (!isDisposed() && request === generation && model.scopes[scope.root] === scope) receive(boardChanges(data, true))
      } finally { if (request === generation && !isDisposed()) commit({ type: 'page.patch', value: { loadingMore: false } }) }
    },
    cancelNavigation() { generation++; realtime.close() },
    invalidateRoute() { routeKey = null },
  }
}
