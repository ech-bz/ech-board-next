import { currentBoard, currentScope, forumKey } from '../../model/selectors/forum'
import { findForum } from '../../model/selectors/navigation'
import type { ForumState } from '../../model/state/forum'
import type { Route } from '../../model/state/navigation'
import type { Commit } from '../commit'
import { failure } from '../errors'
import type { ForumGateway } from '../forumGateway'
import { boardChanges, forumChanges, pageReplacement, threadChanges } from '../ingestion/pages'
import type { Receive } from '../ingestion/receive'
import { saveSidebarCollapsed } from '../io/browser/preferences'
import { EntityId } from '../io/ech/protocol/entityId'
import type { Realtime } from '../synchronization/realtime'

export function createNavigation(model: ForumState, commit: Commit, gateway: ForumGateway, receive: Receive, ready: Promise<void>, realtime: Realtime, isDisposed: () => boolean) {
  let generation = 0
  let routeKey: string | null = null
  return {
    async navigate(route: Route, background = false): Promise<Route | null> {
      await ready
      if (isDisposed()) return null
      const current = model.navigation.context
      if (!current) return null
      if ('slug' in route) commit({ type: 'navigation.patch', value: { lastContentRoute: route } })
      const target = 'forumId' in route && route.forumId ? findForum(model, route.forumId) : current
      if (!target) { commit({ type: 'navigation.patch', value: { loading: false, error: 'Forum relay is unavailable' } }); return null }
      const context = { forumId: forumKey(target.forumId), relayUrl: target.relayUrl }
      const key = route.page === 'thread' ? `${context.forumId}/${route.slug}/${route.threadNum}` : 'slug' in route ? `${context.forumId}/${route.slug}/${route.page}` : `${context.forumId}/${route.page}`
      if (routeKey === key && !model.navigation.error) { commit({ type: 'navigation.patch', value: { route } }); return null }
      routeKey = key
      const request = ++generation
      realtime.close()
      const page: ForumState['page'] = { revision: model.page.revision + 1, forumId: context.forumId, boardId: null, threadId: null, mode: null, loadingMore: false, resyncSequence: model.page.resyncSequence + Number(background) }
      if (route.page === 'settings' || route.page === 'mod') {
        commit(...pageReplacement(model, page), { type: 'navigation.patch', value: { route, context, error: null, loading: false, refreshing: false, reconnecting: false } })
        void gateway.readForum(context.relayUrl).then((data) => {
          if (!isDisposed() && request === generation) receive(forumChanges(data))
        }).catch(() => { })
        return null
      }
      const refresh = background && model.page.forumId === context.forumId
      commit({ type: 'navigation.patch', value: { route, context, error: null, loading: !refresh, refreshing: refresh } })
      try {
        const subscription = route.page === 'thread'
          ? { kind: 'thread' as const, id: EntityId.thread(route.slug, route.threadNum) }
          : 'slug' in route
            ? { kind: 'board' as const, id: EntityId.board(route.slug) }
            : { kind: 'forum' as const, id: context.forumId }
        const revision = await realtime.begin(context.relayUrl, subscription)
        if (isDisposed() || request !== generation) return null
        if (route.page === 'thread') {
          const data = await gateway.readThread(context.relayUrl, route.slug, route.threadNum)
          if (isDisposed() || request !== generation) return null
          await realtime.finish(revision, threadChanges(data), { ...page, boardId: EntityId.board(route.slug), threadId: data.threadId, mode: 'thread' })
        } else if ('slug' in route) {
          const data = await gateway.readBoard(context.relayUrl, route.slug)
          if (isDisposed() || request !== generation) return null
          await realtime.finish(revision, boardChanges(data), { ...page, boardId: data.boardId, mode: 'board' })
        } else {
          const data = await gateway.readForum(context.relayUrl)
          if (isDisposed() || request !== generation) return null
          await realtime.finish(revision, forumChanges(data), page)
        }
      } catch (error) {
        if (request === generation && !isDisposed()) {
          routeKey = null
          if (model.realtime.phase !== 'disconnected') realtime.close()
          commit({ type: 'navigation.patch', value: { error: failure(error), loading: false, refreshing: false } })
        }
      }
      return null
    },
    toggleSidebar() {
      const collapsed = !model.navigation.collapsed
      commit({ type: 'navigation.patch', value: { collapsed } })
      saveSidebarCollapsed(collapsed)
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
