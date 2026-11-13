import { forumKey, numberKey } from '../../model/selectors/forum'
import { findForum } from '../../model/selectors/navigation'
import type { PreviewTarget } from '../../model/state/previews'
import { type Commit } from '../commit'
import { postChanges } from '../ingestion/pages'
import { EntityId } from '../io/ech/protocol/entityId'

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
      const postId = EntityId.post(target.board, target.number)
      const id = nextPreview++
      const scope = model.scopes[root]
      const post = scope?.entities.posts[postId]
      const threadId = post ? scope.threadIds[numberKey(post.board, post.threadNumber)] : null
      const thread = threadId ? scope.entities.threads[threadId] : null
      const op = thread ? scope.postIds[numberKey(thread.board, thread.number)] : null
      const dependencies = [postId, ...op ? [op] : []]
      commit({ type: 'preview.set', value: { id, forumId: root, postId, dependencies, active: true, error: false } })
      if (post && thread && op && scope.entities.posts[op]) return id
      if (!relayUrl) { commit({ type: 'preview.set', value: { ...model.previews[id], error: true } }); return id }
      void readPost(relayUrl, postId).then((data) => {
        if (isDisposed() || !model.previews[id]?.active) return
        const changes = postChanges(data)
        receive({ ...changes, preview: { id, forumId: forumKey(data.forumId), postId, dependencies: [], active: true, error: false } })
      }).catch(() => {
        if (!isDisposed() && model.previews[id]?.active) commit({ type: 'preview.set', value: { ...model.previews[id], error: true } })
      })
      return id
    },
    closePreviews(ids: readonly number[]) { commit({ type: 'preview.close', value: ids }) },
    releasePreviews(ids: readonly number[]) { commit({ type: 'preview.release', value: ids }) }
  }
}
