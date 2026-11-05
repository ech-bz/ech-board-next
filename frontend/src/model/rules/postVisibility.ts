import { toHex } from '../content/hex'
import type { Post } from '../entities/post'
import type { ForumScope } from '../state/forum'

export function postReady(scope: ForumScope, post: Post): boolean {
  return !post.textHash || scope.contents[toHex(post.textHash)] !== undefined
}

export function postContribution(scope: ForumScope, post: Post) {
  const ready = postReady(scope, post)
  return {
    ready,
    counted: !post.deleted,
    visible: ready && !post.deleted,
    media: ready ? post.media.filter((item) => !item.banned).map(({ hash }) => ({ postId: post.id, hash })) : [],
  }
}
