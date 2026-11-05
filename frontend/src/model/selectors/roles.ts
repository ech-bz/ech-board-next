import { identityKey } from '../rules/identity'
import { detectRoles } from '../rules/roles'
import type { ForumScope, ForumState } from '../state/forum'
import { numberKey, scopeModerators } from './forum'

export function rolesFor(scope: ForumScope, boardId: string, threadId?: string | null) {
  const thread = threadId ? scope.entities.threads[threadId] : null
  const opId = thread ? scope.postIds[numberKey(thread.board, thread.number)] : null
  const op = opId ? scope.entities.posts[opId] : null
  const moderators = scopeModerators(scope, boardId, threadId)
  const candidates = new Set([...moderators.forum_mods, ...moderators.board_mods, ...moderators.thread_mods, ...moderators.thread_admin ? [moderators.thread_admin] : []].map(identityKey))
  if (op) candidates.add(op.author)
  const mine = [...candidates].flatMap((esidHex) => {
    const author = scope.authors[esidHex]
    return author?.mine ? [{ esidHex, tweak: author.tweak }] : []
  })
  return detectRoles({
    mine,
    moderators,
    op: op ? mine.find((identity) => identity.esidHex === op.author) : null,
  })
}

export function nextPermissionDeadline(model: ForumState): number | null {
  let next = Infinity
  for (const scope of Object.values(model.scopes)) {
    if (scope.permissionHead !== null) next = Math.min(next, scope.permissionDeadlines[scope.permissionHead].at)
  }
  return Number.isFinite(next) ? next : null
}
