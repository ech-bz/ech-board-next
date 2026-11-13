import { toHex } from '../content/hex'
import { optionalIdentityKey } from '../rules/identity'
import { numberKey, scopeModerators } from '../selectors/forum'
import type { ForumState } from '../state/forum'
import { rolesFor } from './roles'

export function threadFields(model: ForumState, root: string, id: string) {
  const scope = () => model.scopes[root]
  const thread = () => scope().entities.threads[id]
  const op = () => {
    const id = thread().opId
    return id ? scope().entities.posts[id] : null
  }
  return {
    moderation: () => ({
      ...scopeModerators(scope(), scope().boardIds[thread().board]),
      thread_mods: thread().moderators,
      thread_admin: thread().admin,
    }),
    roles: () => rolesFor(scope(), scope().boardIds[thread().board], id),
    opId: () => scope().postIds[numberKey(thread().board, thread().number)] ?? null,
    replyIds: () => thread().lastPosts.flatMap((number) => {
      const id = scope().postIds[numberKey(thread().board, number)]
      return id && !scope().entities.posts[id]?.deleted ? [id] : []
    }),
    topic: () => {
      const hash = thread().topicHash
      const bytes = hash ? scope().contents[toHex(hash)] : null
      return bytes ? new TextDecoder().decode(bytes) : ''
    },
    title: () => thread().topic || op()?.plain.split('\n').find((line) => line.trim()) || '',
    isPinned: () => thread().pinned || (scope().entities.boards[scope().boardIds[thread().board]]?.pinned.includes(thread().number) ?? false),
    opAdmin: () => optionalIdentityKey(thread().admin) !== null && optionalIdentityKey(thread().admin) === op()?.author,
    skipped: () => Math.max(0, thread().postCount - thread().deletedCount - 1 - thread().replyIds.length),
  }
}
