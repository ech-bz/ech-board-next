import { fromHex } from '../../model/content/hex'
import { forumKey, numberKey } from '../../model/selectors/forum'
import { findForum } from '../../model/selectors/navigation'
import type { ForumState } from '../../model/state/forum'
import { postChanges } from '../ingestion/pages'
import { EsidBytes, esidFromHex } from '../io/crypto/esid'
import { EntityId } from '../io/ech/protocol/entityId'
import type { EntityUpdate } from '../state/entities.types'

import type { ForumGateway } from '../forumGateway'
import type { PostResolver } from './bbcode'

const clean = (value: string) => value.replace(/^0x/, '')

export function makePostResolver(ctx: {
  gateway: ForumGateway
  model: ForumState
  receive: (changes: EntityUpdate) => void
  forumId: string
  boardId?: string
  slug?: string
  relayUrl: string
}): PostResolver {
  const revision = ctx.model.page.revision
  return async (ref) => {
    let targetForumId = ctx.forumId
    let targetRelay = ctx.relayUrl
    if (ref.forum) {
      const known = findForum(ctx.model, ref.forum)
      if (!known) return null
      targetForumId = known.forumId
      targetRelay = known.relayUrl
    }
    let targetBoardId: string
    let targetSlug: string
    if (ref.board) {
      targetBoardId = EntityId.board(ref.board)
      targetSlug = ref.board
    } else {
      if (targetForumId !== ctx.forumId || !ctx.boardId || !ctx.slug) return null
      targetBoardId = ctx.boardId
      targetSlug = ctx.slug
    }
    const root = forumKey(targetForumId)
    const scope = ctx.model.scopes[root]
    const knownId = scope?.postIds[numberKey(targetSlug, ref.postNum)]
    let post = knownId ? scope.entities.posts[knownId] : undefined
    if (!post) {
      const id = EntityId.post(targetSlug, ref.postNum)
      const data = await ctx.gateway.readPost(targetRelay, id).catch(() => null)
      if (!data) return null
      if (ctx.model.page.revision !== revision) throw new Error('Page changed')
      const changes = postChanges(data)
      ctx.receive({ ...changes, retention: 'resolved' })
      post = ctx.model.scopes[root]?.entities.posts[id]
    }
    if (!post) return null
    return {
      forum: fromHex(targetForumId),
      board: fromHex(targetBoardId),
      post: fromHex(post.id),
      hint: `${clean(targetForumId)}/${targetSlug}/${ref.postNum}`,
      ...(post.author === null ? {} : { author: EsidBytes(esidFromHex(post.author)) }),
    }
  }
}
