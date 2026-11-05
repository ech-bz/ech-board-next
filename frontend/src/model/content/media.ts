import type { MediaInfo } from '../entities/media'
import type { Post } from '../entities/post'
import type { ForumScope } from '../state/forum'
import { toHex } from './hex'

export function contentUrl(relayUrl: string, kind: string, hex: string): string {
  return `${relayUrl.replace(/\/$/, '')}/${kind === 'thumbnail' ? 'thumbnail' : 'content'}/${hex.replace(/^0x/, '')}`
}

export function postMedia(post: Post, scope: ForumScope): MediaInfo[] {
  const banned = new Set(post.bannedMedia.map(toHex))
  return post.mediaHashes.flatMap((hash) => {
    const hex = toHex(hash)
    const meta = scope.attachments[hex]
    if (!meta) return []
    return [{
      thumbUrl: contentUrl(scope.relayUrl, 'thumbnail', hex),
      fullUrl: contentUrl(scope.relayUrl, 'media', hex),
      width: meta.width,
      height: meta.height,
      mime: meta.mime,
      size: Number(meta.size),
      durationMs: meta.duration_ms !== null ? Number(meta.duration_ms) : null,
      postId: post.id,
      threadId: post.threadId,
      hash: hex,
      banned: banned.has(hex),
    }]
  })
}
