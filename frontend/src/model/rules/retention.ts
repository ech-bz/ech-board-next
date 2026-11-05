import type { Post } from '../entities/post'
import type { ForumScope, ForumState } from '../state/forum'
import type { PostRetention } from '../state/retention'

export function retentionForPost(scope: ForumScope, post: Post, requested?: PostRetention): PostRetention | null {
  if (requested) return requested
  if (scope.loadedThreads[post.threadId]) return 'loaded'
  const thread = scope.entities.threads[post.threadId]
  if (thread && Object.values(scope.boardPages).some((page) => page.threadIds.includes(thread.id)) &&
    (post.number === thread.number || thread.lastPosts.includes(post.number))) return 'loaded'
  return null
}

export function previewPostOwners(model: ForumState, root: string): Set<string> {
  const ids = new Set(Object.values(model.previews).filter((preview) => preview.forumId === root).flatMap((preview) => preview.dependencies))
  if (model.gallery?.forumId === root) ids.add(model.gallery.postId)
  return ids
}
