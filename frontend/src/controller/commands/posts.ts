import type { Post } from '../../model/entities/post'
import { forumKey } from '../../model/selectors/forum'
import { resourceKey } from '../../model/state/resources'
import { type Commit } from '../commit'
import { postChanges } from '../ingestion/pages'
import { Calls } from '../io/ech/forumApi'
import { EntityId } from '../io/ech/protocol/entityId'

import type { ForumState } from '../../model/state/forum'
import type { ForumGateway } from '../forumGateway'
import type { Receive } from '../ingestion/receive'

export function createPostCommands(model: ForumState, commit: Commit, gateway: ForumGateway, receive: Receive) {
  const { readPost, connect } = gateway
  return {
    async resolvePost(relayUrl: string, id: string) {
      const revision = model.page.revision
      const data = await readPost(relayUrl, id)
      if (model.page.revision !== revision) throw new Error('Page changed')
      const changes = postChanges(data)
      receive({ ...changes, retention: 'resolved' })
      const scope = model.scopes[forumKey(data.forumId)]
      return { post: scope.entities.posts[id], board: scope.entities.boards[EntityId.board(data.board.key.slug)], thread: scope.entities.threads[data.threadId] }
    },
    async refetchPost(id: string, myReaction?: string | null, root = model.page.forumId) {
      const scope = root ? model.scopes[forumKey(root)] : null
      if (!scope) return
      const data = await readPost(scope.relayUrl, id)
      if (model.scopes[scope.root] !== scope) return
      const changes = postChanges(data)
      if (myReaction !== undefined) receive(changes, { type: 'reactions.confirm', value: { root: scope.root, values: [[id, myReaction]] } })
      else receive(changes)
    },
    addContent(hash: string, bytes: Uint8Array, root = model.page.forumId) {
      const scope = root ? model.scopes[forumKey(root)] : null
      if (scope) receive({ scope: { forumId: scope.root, relayUrl: scope.relayUrl }, contents: [[hash, bytes]] })
    },
    async reactToPost(record: Post, context: { forumId: string; relayUrl: string }, reaction: string) {
      const id = record.id
      const key = resourceKey(context.forumId, id)
      if (model.operations.reacting[key]) return
      commit({ type: 'reaction.setBusy', value: { key, busy: true } })
      const current = record.myReaction
      const root = forumKey(context.forumId)
      const scope = model.scopes[root]
      commit({ type: 'reaction.setPending', value: { root, id, value: { local: current === reaction ? null : reaction, base: record.myReactionBase } } })
      try {
        const api = await connect(context.relayUrl)
        await api.append(Calls.post.react(id, current, reaction))
      } catch (error) {
        if (model.scopes[root] === scope) commit({ type: 'reaction.setPending', value: { root, id, value: null } })
        throw error
      } finally {
        commit({ type: 'reaction.setBusy', value: { key, busy: false } })
      }
    }
  }
}
