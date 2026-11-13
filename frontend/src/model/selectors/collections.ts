import { createMemo } from 'solid-js'
import type { ForumState } from '../state/forum'
import { currentBoard, currentScope, numberKey, threadById } from './forum'

export function createCollections(model: ForumState) {
  const postIds = () => {
    const id = model.page.threadId
    return id ? currentScope(model)?.threadPosts[id]?.readyIds ?? [] : []
  }
  const visiblePostIds = () => {
    const id = model.page.threadId
    return id && !threadById(model)?.deleted ? currentScope(model)?.threadPosts[id]?.visibleIds ?? [] : []
  }
  const rowIds = createMemo(() => {
    if (model.page.mode !== 'board') return []
    const scope = currentScope(model)
    const board = currentBoard(model)
    if (!scope || !board) return []
    return (scope.boardPages[board.id]?.threadIds ?? []).filter((id) => scope.entities.threads[id])
  })
  const visibleRowIds = createMemo(() => {
    const scope = currentScope(model)
    return rowIds().filter((id) => {
      const thread = scope!.entities.threads[id]
      const op = scope!.entities.posts[scope!.postIds[numberKey(thread.board, thread.number)]]
      return !thread.deleted && !op?.deleted
    })
  })
  const gallery = (showDeleted: boolean) => {
    const root = model.page.forumId
    if (!root) return []
    const ids = (showDeleted ? rowIds() : visibleRowIds()).flatMap((id) => {
      const value = currentScope(model)?.entities.threads[id]
      return value ? [...value.opId ? [value.opId] : [], ...value.replyIds] : []
    })
    return ids.flatMap((id) => model.scopes[root]?.entities.posts[id]?.media.filter((media) => !media.banned && !media.missing) ?? [])
  }
  const allMedia = createMemo(() => model.gallery && model.page.mode === 'board' && model.preferences.showDeleted ? gallery(true) : [])
  const visibleMedia = createMemo(() => model.gallery && model.page.mode === 'board' && !model.preferences.showDeleted ? gallery(false) : [])

  return { postIds, visiblePostIds, rowIds, visibleRowIds, allMedia, visibleMedia }
}
