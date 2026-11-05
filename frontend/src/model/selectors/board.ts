import { toHex } from '../content/hex'
import type { ForumState } from '../state/forum'
import { rolesFor } from './roles'

export function boardFields(model: ForumState, root: string, id: string) {
  const scope = () => model.scopes[root]
  return {
    moderation: () => ({
      forum_mods: Object.values(scope().entities.forums)[0]?.moderators ?? [],
      board_mods: scope().entities.boards[id].moderators,
      thread_mods: [],
      thread_admin: null,
    }),
    roles: () => rolesFor(scope(), id),
    description: () => {
      const hash = scope().entities.boards[id].descriptionHash
      const bytes = hash ? scope().contents[toHex(hash)] : null
      return bytes ? new TextDecoder().decode(bytes) : ''
    },
    next: () => scope().boardPages[id]?.next ?? null,
  }
}
