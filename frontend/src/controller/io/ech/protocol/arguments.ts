import { bcs, type BcsType } from '@mysten/bcs'
import { BoardCursorSchema } from './entities'
import { EsidSchema, Hash } from './transactions'

const hashes = bcs.vector(Hash)
const optionalHash = bcs.option(Hash)

export const ArgumentSchemas: Record<string, BcsType<any, any>> = {
  'forum.create': bcs.struct('Arguments', {}),
  'forum.meta': bcs.struct('Arguments', { forum: Hash }),
  'forum.page': bcs.struct('Arguments', { forum: Hash }),
  'forum.set_title': bcs.struct('Arguments', { forum: Hash, title_hash: Hash }),
  'board.create': bcs.struct('Arguments', { forum: Hash, slug: bcs.string(), description_hash: optionalHash }),
  'board.meta': bcs.struct('Arguments', { board: Hash }),
  'board.page': bcs.struct('Arguments', { board: Hash, cursor: bcs.option(BoardCursorSchema) }),
  'board.set_readonly': bcs.struct('Arguments', { board: Hash, value: bcs.bool() }),
  'board.set_bump_limit': bcs.struct('Arguments', { board: Hash, value: bcs.u32() }),
  'board.set_max_media': bcs.struct('Arguments', { board: Hash, value: bcs.u8() }),
  'board.set_description': bcs.struct('Arguments', { board: Hash, value: optionalHash }),
  'board.set_ignore_forum_bans': bcs.struct('Arguments', { board: Hash, value: bcs.bool() }),
  'board.set_reactions': bcs.struct('Arguments', { board: Hash, values: hashes }),
  'board.set_pinned': bcs.struct('Arguments', { board: Hash, values: bcs.vector(bcs.u64()) }),
  'thread.create': bcs.struct('Arguments', {
    board: Hash,
    topic_hash: optionalHash,
    text_hash: optionalHash,
    media_hashes: hashes,
    name_hash: optionalHash,
    vote_keys: hashes,
    multi_vote: bcs.bool(),
    self_admin: bcs.bool(),
  }),
  'thread.meta': bcs.struct('Arguments', { thread: Hash }),
  'thread.page': bcs.struct('Arguments', { thread: Hash, after: bcs.u64() }),
  'thread.set_closed': bcs.struct('Arguments', { thread: Hash, value: bcs.bool() }),
  'thread.set_pinned': bcs.struct('Arguments', { thread: Hash, value: bcs.bool() }),
  'thread.set_deleted': bcs.struct('Arguments', { thread: Hash, value: bcs.bool() }),
  'thread.set_topic': bcs.struct('Arguments', { thread: Hash, value: optionalHash }),
  'thread.set_admin': bcs.struct('Arguments', { thread: Hash, value: bcs.option(EsidSchema) }),
  'post.create': bcs.struct('Arguments', {
    board: Hash,
    thread: Hash,
    text_hash: optionalHash,
    media_hashes: hashes,
    name_hash: optionalHash,
    vote_keys: hashes,
    multi_vote: bcs.bool(),
  }),
  'post.get': bcs.struct('Arguments', { post: Hash }),
  'post.set_text': bcs.struct('Arguments', { post: Hash, text_hash: optionalHash }),
  'post.set_deleted': bcs.struct('Arguments', { post: Hash, deleted: bcs.bool() }),
  'post.vote': bcs.struct('Arguments', { post: Hash, choices: hashes }),
  'post.react': bcs.struct('Arguments', { post: Hash, old: optionalHash, reaction: Hash }),
  'post.ban_media': bcs.struct('Arguments', { post: Hash, hashes }),
  'post.unban_media': bcs.struct('Arguments', { post: Hash, hashes }),
  'post.set_banned': bcs.struct('Arguments', { post: Hash, banned: bcs.option(EsidSchema) }),
  'post.set_mod_note': bcs.struct('Arguments', { post: Hash, value: optionalHash }),
  'debug.entity': bcs.struct('Arguments', { namespace: bcs.string(), id: Hash }),
  'debug.history': bcs.struct('Arguments', { namespace: bcs.string(), id: Hash, before: bcs.option(bcs.u64()), limit: bcs.u32() }),
  'debug.forum': bcs.struct('Arguments', {}),
}

for (const scope of ['forum', 'board', 'thread']) {
  const entity = { [scope]: Hash }
  ArgumentSchemas[`${scope}.add_moderator`] = bcs.struct('Arguments', { ...entity, member: EsidSchema })
  ArgumentSchemas[`${scope}.remove_moderator`] = bcs.struct('Arguments', { ...entity, member: EsidSchema })
  ArgumentSchemas[`${scope}.ban`] = bcs.struct('Arguments', { ...entity, target: EsidSchema, reason_hash: optionalHash, expires: bcs.u64() })
  ArgumentSchemas[`${scope}.unban`] = bcs.struct('Arguments', { ...entity, target: EsidSchema })
  ArgumentSchemas[`${scope}.ban_list`] = bcs.struct('Arguments', { ...entity, after: bcs.option(EsidSchema), limit: bcs.u32() })
}
