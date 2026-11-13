import type { MediaInfo } from '../entities/media'
import type { Post } from '../entities/post'
import type { ForumScope } from '../state/forum'
import { toHex } from './hex'
import { contentUrl, type ContentPath } from './url'

export function postMedia(post: Post, scope: ForumScope): MediaInfo[] {
  const path: ContentPath = [scope.boardIds[post.board], post.threadId, post.id]
  const banned = new Set(post.bannedMedia.map(toHex))
  return post.mediaHashes.map((hash) => {
    const hex = toHex(hash)
    const meta = scope.attachments[hex]
    const isBanned = banned.has(hex)
    return {
      thumbUrl: contentUrl(scope.relayUrl, path, hex, 'thumbnail'),
      fullUrl: contentUrl(scope.relayUrl, path, hex),
      width: meta?.width ?? 0,
      height: meta?.height ?? 0,
      mime: meta?.mime ?? 'application/octet-stream',
      size: Number(meta?.size ?? 0),
      durationMs: meta?.duration_ms != null ? Number(meta.duration_ms) : null,
      postId: post.id,
      threadId: post.threadId,
      hash: hex,
      banned: isBanned,
      missing: !meta,
    }
  })
}
