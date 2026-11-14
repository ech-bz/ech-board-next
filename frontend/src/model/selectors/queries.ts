import { createMemo } from 'solid-js'
import type { MediaReference } from '../entities/media'
import type { Post } from '../entities/post'
import type { PostReference } from '../entities/postReference'
import type { ForumState } from '../state/forum'
import type { BoardInfo } from '../state/navigation'
import type { StaticInfo } from '../state/page'
import { createCollections } from './collections'
import { currentBoard, currentScope, forumKey, numberKey, referenceKey, scopeModerators, threadById, threadModerators } from './forum'

export function createQueries(model: ForumState) {
  const collections = createCollections(model)
  const get = (id: string, root = model.page.forumId): Post | undefined => root ? model.scopes[forumKey(root)]?.entities.posts[id] : undefined
  const boards = (): BoardInfo[] => {
    const root = model.navigation.context?.forumId
    const scope = root ? model.scopes[forumKey(root)] : null
    return scope ? Object.values(scope.entities.boards).map((board) => ({ slug: board.slug, id: board.id, title: board.description, count: board.postCount })).sort((left, right) => right.count - left.count) : []
  }
  const info = createMemo((): StaticInfo | null => {
    const scope = currentScope(model)
    const board = currentBoard(model)
    const forum = scope ? Object.values(scope.entities.forums)[0] : null
    if (!scope || !board || !forum) return null
    return { relayUrl: scope.relayUrl, forumId: scope.root, forumEntityId: forum.id, boardId: board.id, moderators: scopeModerators(scope, board.id, model.page.threadId), boardReactions: board.reactions }
  })
  const roles = () => {
    const scope = currentScope(model)
    const board = currentBoard(model)
    return scope ? threadById(model)?.roles ?? board?.roles ?? Object.values(scope.entities.forums)[0]?.roles ?? [] : []
  }
  const previewPost = (id: number) => {
    const preview = model.previews[id]
    if (!preview) return undefined
    const scope = model.scopes[preview.forumId]
    const post = scope?.entities.posts[preview.postId]
    return post && scope.entities.boards[scope.boardIds[post.board]] && scope.entities.threads[post.threadId] ? post : undefined
  }
  return {
    boards, info, get, roles, previewPost,
    postId(board: string, number: number, root: string): string | undefined {
      return model.scopes[forumKey(root)]?.postIds[numberKey(board, number)]
    },
    forumObject() {
      const scope = currentScope(model)
      return scope ? Object.values(scope.entities.forums)[0] ?? null : null
    },
    galleryCollection() {
      const empty = { items: [] as MediaReference[], index: -1, revision: 0 }
      const selected = model.gallery
      if (!selected) return empty
      const scope = model.scopes[selected.forumId]
      const post = scope?.entities.posts[selected.postId]
      const media = post?.media.find((item) => item.hash === selected.hash && !item.banned && !item.missing)
      if (!media) return empty
      const showDeleted = model.preferences.showDeleted
      if (selected.forumId === model.page.forumId && model.page.mode === 'thread' && post.threadId === model.page.threadId) {
        const list = scope.threadPosts[post.threadId]
        const position = list?.positions[post.id]
        if (position && (showDeleted || !scope.entities.threads[post.threadId]?.deleted)) {
          const previous = position.position ? list.positions[list.ids[position.position - 1]] : null
          const items = showDeleted ? list.media : list.visibleMedia
          const start = (showDeleted ? previous?.mediaCount : previous?.visibleMediaCount) ?? 0
          const end = showDeleted ? position.mediaCount : position.visibleMediaCount
          for (let index = start; index < end; index++) if (items[index].hash === selected.hash) return { items, index, revision: list.mediaRevision }
        }
      }
      if (selected.forumId === model.page.forumId && model.page.mode === 'board') {
        const media = showDeleted ? collections.allMedia() : collections.visibleMedia()
        const index = media.findIndex((item) => item.postId === selected.postId && item.hash === selected.hash)
        if (index >= 0) return { items: media.map(({ postId, hash }) => ({ postId, hash })), index, revision: 0 }
      }
      return { items: [{ postId: selected.postId, hash: selected.hash }], index: 0, revision: 0 }
    },
    galleryMedia(reference: MediaReference | undefined) {
      const selected = model.gallery
      return selected && reference ? model.scopes[selected.forumId]?.entities.posts[reference.postId]?.media.find((item) => item.hash === reference.hash && !item.banned && !item.missing) : undefined
    },
    galleryMediaFor(forumId: string, reference: MediaReference) {
      return model.scopes[forumKey(forumId)]?.entities.posts[reference.postId]?.media.find((item) => item.hash === reference.hash && !item.banned && !item.missing)
    },
    forumModerators() {
      const scope = currentScope(model)
      return scope ? scopeModerators(scope, '') : null
    },
    postsOf: (showDeleted: boolean) => showDeleted ? collections.postIds() : collections.visiblePostIds(),
    rowIds: (showDeleted: boolean) => showDeleted ? collections.rowIds() : collections.visibleRowIds(),
    boardObject: () => currentBoard(model),
    threadObject: (id?: string) => threadById(model, id),
    threadId: () => model.page.threadId,
    threadNumber: () => threadById(model)?.number ?? null,
    opId: () => threadById(model)?.opId ?? null,
    page: () => {
      const scope = currentScope(model), thread = threadById(model)
      return scope && thread && scope.loadedThreads[thread.id] ? thread : null
    },
    boardInfo: () => {
      const scope = currentScope(model), board = currentBoard(model)
      return scope && board && scope.boardPages[board.id] ? board : null
    },
    threadTitle: () => threadById(model)?.title ?? '',
    threadTopic: (id: string) => threadById(model, id)?.topic ?? '',
    pinnedNumbers: () => currentBoard(model)?.pinned ?? [],
    isThreadPinned: (id: string) => threadById(model, id)?.isPinned ?? false,
    boardModerators: () => currentBoard(model)?.moderators ?? [],
    moderatorsOf: (id: string) => threadModerators(model, id),
    rolesForThread: (id: string) => {
      const scope = currentScope(model), thread = threadById(model, id)
      const boardId = thread ? scope?.boardIds[thread.board] : model.page.boardId
      return scope && boardId ? (thread?.roles ?? scope.entities.boards[boardId]?.roles ?? []).filter((role) => role.kind === 'thread_admin' || role.kind === 'thread_mod') : []
    },
    referencesTo: (id: string, root = model.page.forumId): readonly PostReference[] => {
      const post = get(id, root)
      return root && post ? model.references[referenceKey(root, numberKey(post.board, post.number))]?.items ?? [] : []
    },
    ordinalOf: (id: string) => model.page.mode === 'thread' && model.page.threadId ? currentScope(model)?.threadPosts[model.page.threadId]?.positions[id]?.ordinal ?? null : null,
    threadPosts: () => model.page.threadId ? currentScope(model)?.threadPosts[model.page.threadId] : undefined,
    postVisible: (id: string, showDeleted: boolean) => {
      const scope = currentScope(model), post = scope?.entities.posts[id]
      return !!scope && !!post && post.threadId === model.page.threadId && (showDeleted || !post.deleted && !scope.entities.threads[post.threadId]?.deleted)
    },
    containsPost(root: string, threadId: string, id: string): boolean {
      const scope = model.scopes[forumKey(root)]
      const post = scope?.entities.posts[id]
      return !!post && scope.threadIds[numberKey(post.board, post.threadNumber)] === threadId
    },
    resyncSeq: () => model.page.resyncSequence,
    loadingMoreThreads: () => model.page.loadingMore,
    previewContext(id: number) {
      const preview = model.previews[id], post = previewPost(id)
      const scope = preview ? model.scopes[preview.forumId] : null
      if (!scope || !post) return null
      return { relayUrl: scope.relayUrl, forumId: scope.root, boardId: scope.boardIds[post.board], slug: post.board, thread: scope.entities.threads[post.threadId] }
    },
    forumEntityId(relayUrl: string) {
      const scope = Object.values(model.scopes).find((scope) => scope.relayUrl === relayUrl)
      return scope ? Object.values(scope.entities.forums)[0]?.id ?? null : null
    },
    relayUrl(root: string) {
      const key = forumKey(root)
      return model.scopes[key]?.relayUrl ?? model.navigation.forums.find((forum) => forum.forumId === key)?.relayUrl ?? null
    },
  }
}

export type ForumQueries = ReturnType<typeof createQueries>
