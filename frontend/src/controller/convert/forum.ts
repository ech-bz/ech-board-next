import { withDerived } from '../../model/derive'
import type { Forum } from '../../model/entities/forum'
import { forumFields } from '../../model/selectors/forumEntity'
import type { ForumState } from '../../model/state/forum'
import type { ForumEntity } from '../io/ech/protocol/entities'
import { EntityId } from '../io/ech/protocol/entityId'
import { convertBytes } from './bytes'
import { convertIdentity } from './identity'
import { forumValue } from './versions'

export function convertForum(entity: ForumEntity, model: ForumState, root: string): Forum {
  const value = forumValue(entity)
  const previous = model.scopes[root]?.entities.forums[EntityId.forum()]
  return withDerived({
    id: EntityId.forum(),
    sequence: entity.history.length,
    titleHash: value.title_hash ? convertBytes(value.title_hash, previous?.titleHash) : null,
    moderators: value.moderators.map((identity, index) => convertIdentity(identity, previous?.moderators[index])),
  }, forumFields(model, root, EntityId.forum()))
}
