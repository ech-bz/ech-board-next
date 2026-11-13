import { forumKey, numberKey } from '../../model/selectors/forum'
import { findForum } from '../../model/selectors/navigation'
import type { PreviewTarget } from '../../model/state/previews'
import { type Commit } from '../commit'
import { postChanges } from '../ingestion/pages'

import type { ForumState } from '../../model/state/forum'
import type { ForumGateway } from '../forumGateway'
import type { Receive } from '../ingestion/receive'

export function createPreviewCommands(model: ForumState, commit: Commit, gateway: ForumGateway, receive: Receive, isDisposed: () => boolean) {
  let nextPreview = 1
  const { readPost } = gateway
  return {
    openPreview(target: PreviewTarget) {
      const root = forumKey(target.forumId ?? model.page.forumId ?? '')
      const relayUrl = target.relayUrl ?? model.scopes[root]?.relayUrl ?? findForum(model, root)?.relayUrl
      const id = nextPreview++
      const scope = model.scopes[root]
      const post = scope?.entities.posts[target.postId]
      const threadId = post ? scope.threadIds[numberKey(post.board, post.threadNumber)] : null
      const thread = threadId ? scope.entities.threads[threadId] : null
      const op = thread ? scope.postIds[numberKey(thread.board, thread.number)] : null
      const dependencies = [target.postId, ...op ? [op] : []]
      commit({ type: 'preview.set', value: { id, forumId: root, postId: target.postId, dependencies, active: true, error: false } })
      if (post && thread && op && scope.entities.posts[op]) return id
      if (!relayUrl) { commit({ type: 'preview.set', value: { ...model.previews[id], error: true } }); return id }
      void readPost(relayUrl, target.postId).then((data) => {
        if (isDisposed() || !model.previews[id]?.active) return
        const changes = postChanges(data)
        receive({ ...changes, preview: { id, forumId: forumKey(data.forumId), postId: target.postId, dependencies: [], active: true, error: false } })
      }).catch(() => {
        if (!isDisposed() && model.previews[id]?.active) commit({ type: 'preview.set', value: { ...model.previews[id], error: true } })
      })
      return id
    },
    closePreviews(ids: readonly number[]) { commit({ type: 'preview.close', value: ids }) },
    releasePreviews(ids: readonly number[]) { commit({ type: 'preview.release', value: ids }) }
  }
}
