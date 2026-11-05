import type { Post } from '../entities/post'

export function mergePostOrder(current: readonly string[], added: readonly string[], posts: Record<string, Post>): string[] {
  const result: string[] = []
  let index = 0
  for (const id of current) {
    while (index < added.length && posts[added[index]].number < posts[id].number) result.push(added[index++])
    result.push(id)
  }
  return result.concat(added.slice(index))
}
