import type { Board } from '../entities/board'
import type { Thread } from '../entities/thread'
import type { Moderators } from '../rules/roles'
import type { ForumScope, ForumState } from '../state/forum'

export const forumKey = (root: string): string => root.replace(/^0x/i, '').toLowerCase()
export const referenceKey = (root: string, id: string): string => `${forumKey(root)}:${id.toLowerCase()}`
export const numberKey = (board: string, number: number): string => `${board}/${number}`

export function currentScope(state: ForumState): ForumScope | null {
  return state.page.forumId ? state.scopes[state.page.forumId] ?? null : null
}

export function currentBoard(state: ForumState): Board | null {
  const scope = currentScope(state)
  const id = state.page.boardId
  return scope && id ? scope.entities.boards[id] ?? null : null
}

export function threadById(state: ForumState, id = state.page.threadId): Thread | null {
  const scope = currentScope(state)
  return scope && id ? scope.entities.threads[id] ?? null : null
}

export function scopeModerators(scope: ForumScope, boardId: string, threadId?: string | null): Moderators {
  const thread = threadId ? scope.entities.threads[threadId] : null
  if (thread) return thread.moderation
  const board = scope.entities.boards[boardId]
  if (board) return board.moderation
  const forum = Object.values(scope.entities.forums)[0]
  return {
    forum_mods: forum?.moderators ?? [],
    board_mods: [],
    thread_mods: [],
    thread_admin: null,
  }
}

export function threadModerators(state: ForumState, id: string): Moderators {
  const scope = currentScope(state)
  const thread = scope?.entities.threads[id]
  const boardId = thread ? scope!.boardIds[thread.board] : state.page.boardId
  return scope && boardId ? scopeModerators(scope, boardId, id) : { forum_mods: [], board_mods: [], thread_mods: [], thread_admin: null }
}
