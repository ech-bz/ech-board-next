import { toHex } from '../../model/content/hex'
import type { EntityUpdate } from '../state/entities.types'
import { boardValue, forumValue, postValue, threadValue } from './versions'

export function requiredResources(changes: EntityUpdate) {
  const contentHashes = new Set<string>()
  const attachmentHashes = new Set<string>()
  const content = (hash: Uint8Array | null) => { if (hash) contentHashes.add(toHex(hash)) }
  for (const entity of changes.posts ?? []) {
    const post = postValue(entity)
    content(post.text_hash)
    content(post.name_hash)
    content(post.mod_note_hash)
    for (const [hash] of post.votes) content(hash)
    for (const hash of post.media_hashes) attachmentHashes.add(toHex(hash))
  }
  for (const entity of changes.threads ?? []) content(threadValue(entity).topic_hash)
  for (const entity of changes.boards ?? []) {
    const board = boardValue(entity)
    content(board.description_hash)
    for (const hash of board.reactions) attachmentHashes.add(toHex(hash))
  }
  for (const entity of changes.forums ?? []) content(forumValue(entity).title_hash)
  return { contentHashes, attachmentHashes }
}
