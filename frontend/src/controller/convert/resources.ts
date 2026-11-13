import type { ContentPath } from '../../model/content/url'
import { EntityId } from '../io/ech/protocol/entityId'
import { toHex } from '../../model/content/hex'
import type { EntityUpdate } from '../state/entities.types'
import { boardValue, forumValue, postValue, threadValue } from './versions'

export function requiredResources(changes: EntityUpdate) {
  const contentHashes = new Map<string, ContentPath>()
  const attachmentHashes = new Map<string, ContentPath>()
  const content = (hash: Uint8Array | null, owner: ContentPath) => { if (hash) contentHashes.set(toHex(hash), owner) }
  for (const entity of changes.posts ?? []) {
    const post = postValue(entity)
    const owner: ContentPath = [EntityId.board(entity.key.board), EntityId.thread(entity.key.board, Number(post.thread)), EntityId.post(entity.key.board, Number(entity.key.number))]
    content(post.text_hash, owner)
    content(post.name_hash, owner)
    content(post.mod_note_hash, owner)
    for (const [hash] of post.votes) content(hash, owner)
    for (const hash of post.media_hashes) attachmentHashes.set(toHex(hash), owner)
  }
  for (const entity of changes.threads ?? []) {
    const thread = threadValue(entity)
    content(thread.topic_hash, [EntityId.board(entity.key.board), EntityId.thread(entity.key.board, Number(entity.key.number))])
  }
  for (const entity of changes.boards ?? []) {
    const board = boardValue(entity)
    const owner: ContentPath = [EntityId.board(entity.key.slug)]
    content(board.description_hash, owner)
    for (const hash of board.reactions) attachmentHashes.set(toHex(hash), owner)
  }
  for (const entity of changes.forums ?? []) content(forumValue(entity).title_hash, ['forum'])
  return { contentHashes, attachmentHashes }
}
