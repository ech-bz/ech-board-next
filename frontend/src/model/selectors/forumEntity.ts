import { toHex } from '../content/hex'
import type { ForumState } from '../state/forum'
import { rolesFor } from './roles'

export function forumFields(model: ForumState, root: string, id: string) {
  return {
    roles: () => rolesFor(model.scopes[root], ''),
    title: () => {
      const scope = model.scopes[root]
      const hash = scope.entities.forums[id].titleHash
      const bytes = hash ? scope.contents[toHex(hash)] : null
      return bytes ? new TextDecoder().decode(bytes) : ''
    },
  }
}
