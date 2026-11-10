import { produce, type SetStoreFunction } from 'solid-js/store'
import { selfModerationDeadline } from '../../model/rules/permissions'
import { numberKey } from '../../model/selectors/forum'
import type { ForumState } from '../../model/state/forum'

export function removePermissionDeadline(model: ForumState, write: SetStoreFunction<ForumState>, root: string, id: string) {
  const entry = model.scopes[root].permissionDeadlines[id]
  if (!entry) return
  const { previous, next } = entry
  if (previous === null) write('scopes', root, 'permissionHead', next)
  else write('scopes', root, 'permissionDeadlines', previous, 'next', next)
  if (next === null) write('scopes', root, 'permissionTail', previous)
  else write('scopes', root, 'permissionDeadlines', next, 'previous', previous)
  write('scopes', root, 'permissionDeadlines', produce((values) => { delete values[id] }))
}

export function refreshPermissions(model: ForumState, write: SetStoreFunction<ForumState>, update: { root: string; posts: { board: string; number: number }[]; at: number }) {
  const { root } = update
  const scope = model.scopes[root]
  for (const key of update.posts) {
    const id = scope.postIds[numberKey(key.board, key.number)]
    const post = scope.entities.posts[id]
    if (!post) continue
    const at = selfModerationDeadline(
      post.createdAt,
      post.author !== null && (scope.authors[post.author]?.mine ?? false),
      update.at,
    )
    if (scope.permissionDeadlines[id]?.at === at) continue
    removePermissionDeadline(model, write, root, id)
    if (at === null) continue
    let previous = scope.permissionTail
    while (previous !== null && scope.permissionDeadlines[previous].at > at) previous = scope.permissionDeadlines[previous].previous
    const next = previous === null ? scope.permissionHead : scope.permissionDeadlines[previous].next
    write('scopes', root, 'permissionDeadlines', id, { at, previous, next })
    if (previous === null) write('scopes', root, 'permissionHead', id)
    else write('scopes', root, 'permissionDeadlines', previous, 'next', id)
    if (next === null) write('scopes', root, 'permissionTail', id)
    else write('scopes', root, 'permissionDeadlines', next, 'previous', id)
  }
}

export function expirePermissions(model: ForumState, write: SetStoreFunction<ForumState>, now: number) {
  for (const [root, scope] of Object.entries(model.scopes)) {
    while (scope.permissionHead !== null && scope.permissionDeadlines[scope.permissionHead].at <= now) {
      removePermissionDeadline(model, write, root, scope.permissionHead)
    }
  }
}
