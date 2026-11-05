import { withDerived } from '../../model/derive'
import type { Post } from '../../model/entities/post'
import { postEquality, postFields } from '../../model/selectors/post'
import type { ForumState } from '../../model/state/forum'
import type { PostEntity } from '../io/ech/protocol/entities'
import { entitySender, entityTime } from './genesis'
import { convertIdentity } from './identity'
import { postValue } from './versions'

export function convertPost(entity: PostEntity, model: ForumState, root: string, id: string): Post {
  const value = postValue(entity)
  return withDerived({
    id,
    sequence: entity.seq,
    number: Number(entity.key.number),
    board: entity.key.board,
    threadNumber: Number(value.thread),
    author: entitySender(entity),
    createdAt: entityTime(entity),
    textHash: value.text_hash?.slice() ?? null,
    mediaHashes: value.media_hashes.map((hash) => hash.slice()),
    nameHash: value.name_hash?.slice() ?? null,
    country: value.country,
    deleted: value.deleted,
    bannedMedia: value.banned_media.map((hash) => hash.slice()),
    edited: value.edited,
    multipleVotes: value.multi_vote,
    votes: value.votes.map(([hash, count]) => ({ hash: hash.slice(), count: BigInt(count) })),
    reactionCounts: value.reactions.map(([hash, count]) => ({ hash: hash.slice(), count: BigInt(count) })),
    moderatorNoteHash: value.mod_note_hash?.slice() ?? null,
    bannedBy: value.banned ? convertIdentity(value.banned) : null,
  }, postFields(model, root, id), postEquality)
}
