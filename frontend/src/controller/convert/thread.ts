import { withDerived } from '../../model/derive'
import type { Thread } from '../../model/entities/thread'
import { threadFields } from '../../model/selectors/thread'
import type { ForumState } from '../../model/state/forum'
import type { ThreadEntity } from '../io/ech/protocol/entities'
import { EntityId } from '../io/ech/protocol/entityId'
import { convertBytes } from './bytes'
import { convertIdentity } from './identity'
import { threadValue } from './versions'

export function convertThread(entity: ThreadEntity, model: ForumState, root: string): Thread {
  const value = threadValue(entity)
  const id = EntityId.thread(entity.key.board, Number(entity.key.number))
  const previous = model.scopes[root]?.entities.threads[id]
  return withDerived({
    id,
    sequence: entity.history.length,
    number: Number(entity.key.number),
    board: entity.key.board,
    topicHash: value.topic_hash ? convertBytes(value.topic_hash, previous?.topicHash) : null,
    closed: value.closed,
    pinned: value.pinned,
    deleted: value.deleted,
    postCount: Number(value.post_count),
    bump: BigInt(value.bump),
    lastPosts: value.last_posts.map(Number),
    admin: value.admin ? convertIdentity(value.admin, previous?.admin) : null,
    moderators: value.moderators.map((identity, index) => convertIdentity(identity, previous?.moderators[index])),
  }, threadFields(model, root, id))
}
