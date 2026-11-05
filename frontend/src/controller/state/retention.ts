import { produce, type SetStoreFunction } from 'solid-js/store'
import { previewPostOwners, retentionForPost } from '../../model/rules/retention'
import type { ForumState } from '../../model/state/forum'
import type { PostRetention } from '../../model/state/retention'

export function createPostRetention(model: ForumState, write: SetStoreFunction<ForumState>) {
  const track = (root: string, id: string, requested?: PostRetention) => {
    const scope = model.scopes[root]
    const lifetime = scope.postLifetime
    const reason = retentionForPost(scope, scope.entities.posts[id], requested)
    if (reason) {
      write('scopes', root, 'postLifetime', 'retained', id, reason)
      if (lifetime.temporary[id]) write('scopes', root, 'postLifetime', 'temporary', produce((ids) => { delete ids[id] }))
    } else if (!lifetime.retained[id]) write('scopes', root, 'postLifetime', 'temporary', id, true)
  }

  const release = (remove: (root: string, ids: string[]) => void) => {
    for (const [root, scope] of Object.entries(model.scopes)) {
      const held = previewPostOwners(model, root)
      const ids = Object.keys(scope.postLifetime.temporary).filter((id) => !held.has(id))
      if (!ids.length) continue
      remove(root, ids)
      write('scopes', root, 'postLifetime', 'temporary', produce((values) => { for (const id of ids) delete values[id] }))
    }
  }

  return { track, release }
}

export type PostRetentionPolicy = ReturnType<typeof createPostRetention>
