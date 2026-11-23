import { blake2b } from '@noble/hashes/blake2'

import { fromHex, toHex } from '../content/hex'
import { postMedia } from '../content/media'
import { partsToPlainText } from '../content/posts'
import { reactionUrl } from '../content/reactions'
import type { Post } from '../entities/post'
import { optionalIdentityKey } from '../rules/identity'
import { canPostAction, canUnbanMedia, type PostAction } from '../rules/permissions'
import { postRole } from '../rules/roles'
import { forumKey, numberKey, referenceKey, scopeModerators } from '../selectors/forum'
import type { ForumState } from '../state/forum'

const EMPTY_PARTS: Post['parts'] = []

export function postFields(model: ForumState, root: string, id: string) {
  const localScope = model.scopes[root]
  const scope = () => localScope
  const post = () => scope().entities.posts[id]
  const thread = () => scope().entities.threads[post().threadId]
  const boardId = () => scope().boardIds[post().board]
  const board = () => scope().entities.boards[boardId()]
  const roles = () => thread()?.roles ?? board()?.roles ?? []
  const allowed = (action: PostAction) => canPostAction(action, roles().map((role) => role.kind), scope().permissionDeadlines[id] !== undefined)
  const forumHost = (forum: string) => {
    const entry = model.navigation.forums.find((value) => forumKey(value.forumId) === forum)
    return entry ? new URL(entry.relayUrl).host : null
  }

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
    flagUrl: () => post().country ? `/static/flags/${String(post().country).padStart(3, '0')}.svg` : null,
    hasText: () => post().parts.length > 0,
    parts: () => {
      const hash = post().textHash
      if (!hash) return EMPTY_PARTS
      const key = toHex(hash)
      return scope().parts[key] ?? EMPTY_PARTS
    },
    plain: () => {
      const parts = post().parts
      return partsToPlainText(parts, true, { forumId: root, board: post().board, forumHost })
    },
    refs: () => {
      const items = model.references[referenceKey(root, numberKey(post().board, post().number))]?.items ?? []
      if (model.preferences.showDeleted) return items
      return items.filter((ref) => !scope().entities.posts[ref.postId]?.deleted)
    },
    refsRevision: () => model.references[referenceKey(root, numberKey(post().board, post().number))]?.revision ?? 0,
    media: () => postMedia(post(), scope()),
    reactions: () => {
      const available = new Set((board()?.reactions ?? []).map(toHex))
      const selected = post().myReaction
      const base = post().myReactionBase
      const counts = new Map<string, number>()
      for (const { hash, count } of post().reactionCounts) {
        const hex = toHex(hash)
        if (!available.has(hex)) continue
        const value = Number(count) + Number(selected === hex && base !== hex) - Number(base === hex && selected !== hex)
        if (value > 0) counts.set(hex, value)
      }
      if (selected && available.has(selected) && !counts.has(selected)) counts.set(selected, 1)
      return [...counts].sort((a, b) => b[1] - a[1]).map(([hex, count]) => ({ hex, count, url: reactionUrl(scope().relayUrl, hex, boardId()) }))
    },
    reactionGlyph: () => {
      const hashes = board()?.reactions ?? []
      if (!hashes.length) return null
      const digest = blake2b(fromHex(id), { dkLen: 32 })
      const shard = new DataView(digest.buffer, digest.byteOffset + 24, 8).getBigUint64(0, false)
      return reactionUrl(scope().relayUrl, toHex(hashes[Number(shard % BigInt(hashes.length))]), boardId())
    },
    myReaction: () => {
      const base = post().myReactionBase
      const pending = scope().pendingReactions[id]
      return pending && pending.base === base ? pending.local : base
    },
    myReactionBase: () => scope().myReactions[id]?.value ?? null,
    bannedScopes: () => scope().postBans[id] ?? [],
    reactionPending: () => scope().pendingReactions[id] !== undefined,
    repliedMine: () => {
      const targets = model.outgoing[referenceKey(root, id)]
      if (!targets) return false
      const prefix = `${forumKey(root)}:`
      for (const target of targets) {
        if (!target.startsWith(prefix)) continue
        const rest = target.slice(prefix.length)
        const slash = rest.lastIndexOf('/')
        if (slash < 0) continue
        const targetId = scope().postIds[numberKey(rest.slice(0, slash), Number(rest.slice(slash + 1)))]
        const author = targetId ? scope().entities.posts[targetId]?.author : null
        if (author && scope().authors[author]?.mine) return true
      }
      return false
    },
    hidden: () => post().deleted || post().op && (thread()?.deleted ?? false),
    mine: () => {
      const author = post().author
      return author !== null && (scope().authors[author]?.mine ?? false)
    },
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
    return media.thumbUrl === next.thumbUrl && media.fullUrl === next.fullUrl && media.width === next.width && media.height === next.height && media.mime === next.mime && media.size === next.size && media.durationMs === next.durationMs && media.hash === next.hash && media.banned === next.banned && media.missing === next.missing && media.threadId === next.threadId
  }),
  reactions: (left: Post['reactions'], right: Post['reactions']) => left.length === right.length && left.every((reaction, index) => reaction.hex === right[index].hex && reaction.count === right[index].count && reaction.url === right[index].url),
}
