import { withDerived } from '../../model/derive'
import type { Board } from '../../model/entities/board'
import { boardFields } from '../../model/selectors/board'
import type { ForumState } from '../../model/state/forum'
import type { BoardEntity } from '../io/ech/protocol/entities'
import { EntityId } from '../io/ech/protocol/entityId'
import { convertBytes } from './bytes'
import { convertIdentity } from './identity'
import { boardValue } from './versions'

export function convertBoard(entity: BoardEntity, model: ForumState, root: string): Board {
  const value = boardValue(entity)
  const previous = model.scopes[root]?.entities.boards[EntityId.board(entity.key.slug)]
  return withDerived({
    id: EntityId.board(entity.key.slug),
    sequence: entity.seq,
    slug: entity.key.slug,
    descriptionHash: value.description_hash ? convertBytes(value.description_hash, previous?.descriptionHash) : null,
    readonly: value.readonly,
    bumpLimit: value.bump_limit,
    maxMedia: value.max_media,
    threadCount: Number(value.thread_count),
    postCount: Number(value.post_count),
    pinned: value.pinned.map(Number),
    reactions: value.reactions.map((hash, index) => convertBytes(hash, previous?.reactions[index])),
    moderators: value.moderators.map((identity, index) => convertIdentity(identity, previous?.moderators[index])),
    ignoreForumBans: value.ignore_forum_bans,
  }, boardFields(model, root, EntityId.board(entity.key.slug)))
}
