import { fromHex, toHex } from '../content/hex'
import { postMedia } from '../content/media'
import { partsToPlainText } from '../content/posts'
import { reactionUrl } from '../content/reactions'
import { shardIndex } from '../content/shard'
import type { Post } from '../entities/post'
import { optionalIdentityKey } from '../rules/identity'
import { canPostAction, canUnbanMedia, type PostAction } from '../rules/permissions'
import { postRole } from '../rules/roles'
import { numberKey, referenceKey, scopeModerators } from '../selectors/forum'
import type { ForumState } from '../state/forum'

export function postFields(model: ForumState, root: string, id: string) {
  const scope = () => model.scopes[root]
  const post = () => scope().entities.posts[id]
  const thread = () => scope().entities.threads[post().threadId]
  const boardId = () => scope().boardIds[post().board]
  const board = () => scope().entities.boards[boardId()]
  const roles = () => thread()?.roles ?? board()?.roles ?? []
  const allowed = (action: PostAction) => canPostAction(action, roles().map((role) => role.kind), scope().permissionDeadlines[id] !== undefined)

  return {
    threadId: () => scope().threadIds[numberKey(post().board, post().threadNumber)] ?? '',
    relNum: () => {
      if (model.page.forumId !== root || model.page.threadId !== post().threadId) return null
      return scope().threadPosts[post().threadId]?.positions[id]?.ordinal ?? null
    },
    op: () => post().number === post().threadNumber,
    name: () => {
      const hash = post().nameHash
      const bytes = hash ? scope().contents[toHex(hash)] : null
      return bytes ? new TextDecoder().decode(bytes) || null : null
    },
    tripText: () => null,
    tripSecured: () => false,
    flagUrl: () => post().country ? `/static/flags/${String(post().country).padStart(3, '0')}.svg` : null,
    hasText: () => post().textHash !== null,
    parts: () => {
      const hash = post().textHash
      if (!hash) return []
      const key = toHex(hash)
      return scope().parts[key] ?? (scope().contents[key] ? [] : null)
    },
    plain: () => {
      const parts = post().parts
      return parts ? partsToPlainText(parts, true, { forumId: root, boardId: boardId() }) : ''
    },
    refs: () => model.references[referenceKey(root, id)]?.items ?? [],
    refsRevision: () => model.references[referenceKey(root, id)]?.revision ?? 0,
    media: () => postMedia(post(), scope()),
    reactions: () => {
      const selected = post().myReaction
      const base = post().myReactionBase
      const counts = new Map<string, number>()
      for (const { hash, count } of post().reactionCounts) {
        const hex = toHex(hash)
        const value = Number(count) + Number(selected === hex && base !== hex) - Number(base === hex && selected !== hex)
        if (value > 0) counts.set(hex, value)
      }
      if (selected && !counts.has(selected)) counts.set(selected, 1)
      return [...counts].sort((a, b) => b[1] - a[1]).map(([hex, count]) => ({ hex, count, url: reactionUrl(scope().relayUrl, hex) }))
    },
    reactionGlyph: () => {
      const hashes = board()?.reactions ?? []
      return hashes.length ? reactionUrl(scope().relayUrl, toHex(hashes[shardIndex(fromHex(id), hashes.length)])) : null
    },
    myReaction: () => {
      const base = post().myReactionBase
      const pending = scope().pendingReactions[id]
      return pending && pending.base === base ? pending.local : base
    },
    myReactionBase: () => scope().myReactions[id] ?? null,
    repliedMine: () => false,
    hidden: () => post().deleted || post().op && (thread()?.deleted ?? false),
    banned: () => post().bannedBy !== null,
    bannedLevel: () => optionalIdentityKey(post().bannedBy),
    mine: () => scope().authors[post().author]?.mine ?? false,
    role: () => {
      const current = thread()
      const op = current?.opId ? scope().entities.posts[current.opId] : null
      return postRole(post().author, scopeModerators(scope(), boardId(), post().threadId), post().op ? post().author : op?.author ?? null)
    },
    canEdit: () => allowed('edit') && !post().hidden,
    canDelete: () => allowed('delete') && !post().hidden,
    canRestore: () => allowed('restore') && post().hidden,
    canBanMedia: () => allowed('ban_media') && !post().hidden && post().mediaHashes.length > 0,
    canUnbanMedia: () => canUnbanMedia(roles().map((role) => role.kind)) && !post().hidden && post().bannedMedia.length > 0,
    deadline: () => scope().permissionDeadlines[id]?.at ?? null,
  }
}

export const postEquality = {
  media: (left: Post['media'], right: Post['media']) => left.length === right.length && left.every((media, index) => {
    const next = right[index]
    return media.thumbUrl === next.thumbUrl && media.fullUrl === next.fullUrl && media.width === next.width && media.height === next.height && media.mime === next.mime && media.size === next.size && media.durationMs === next.durationMs && media.hash === next.hash && media.banned === next.banned && media.threadId === next.threadId
  }),
  reactions: (left: Post['reactions'], right: Post['reactions']) => left.length === right.length && left.every((reaction, index) => reaction.hex === right[index].hex && reaction.count === right[index].count && reaction.url === right[index].url),
}
