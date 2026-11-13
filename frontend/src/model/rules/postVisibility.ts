import type { Post } from '../entities/post'

export function postContribution(post: Post) {
  return {
    ready: true,
    counted: !post.deleted,
    visible: !post.deleted,
    media: post.media.filter((item) => !item.banned && !item.missing).map(({ hash }) => ({ postId: post.id, hash })),
  }
}
