import type { ForumState } from '../state/forum'

export function findForum(model: ForumState, value: string) {
  const target = value.replace(/^0x/i, '').replace(/^https?:\/\//, '').toLowerCase()
  if (!target) return null
  return model.navigation.forums.find((forum) => {
    const id = forum.forumId.replace(/^0x/i, '').toLowerCase()
    const url = forum.relayUrl.replace(/^https?:\/\//, '').toLowerCase()
    return id === target || id.startsWith(target) || target.startsWith(id) || url === target || url.startsWith(target) || target.startsWith(url)
  }) ?? null
}
