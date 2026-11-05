import { toHex } from '../content/hex'
import { replyTargets } from '../content/references'
import type { PostReference } from '../entities/postReference'
import { referenceKey } from '../selectors/forum'
import type { ForumState } from '../state/forum'

interface ReferenceUpdate {
  source: string
  reference: PostReference | null
  targets: string[] | null
  added: string[]
  removed: string[]
}

export function referenceUpdates(model: ForumState, root: string, ids: Iterable<string>, removed = false): ReferenceUpdate[] {
  const scope = model.scopes[root]
  const updates: ReferenceUpdate[] = []
  for (const id of ids) {
    const post = removed ? undefined : scope.entities.posts[id]
    const source = referenceKey(root, id)
    const parts = post?.textHash ? scope.parts[toHex(post.textHash)] ?? [] : []
    const next = post ? replyTargets(parts) : new Set<string>()
    const previous = new Set(model.outgoing[source] ?? [])
    if (post && previous.size === next.size && [...previous].every((target) => next.has(target))) continue
    updates.push({
      source,
      reference: post ? { postId: id, number: post.number, forumId: root, board: post.board, threadNumber: post.threadNumber } : null,
      targets: post ? [...next] : null,
      added: [...next].filter((target) => !previous.has(target)),
      removed: [...previous].filter((target) => !next.has(target)),
    })
  }
  return updates
}
