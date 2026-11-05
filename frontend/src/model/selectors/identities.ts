import type { ForumScope } from '../state/forum'

export function ownIdentities(scope: ForumScope) {
  return scope.ownedAuthorIds.map((esidHex) => ({ esidHex, tweak: scope.authors[esidHex].tweak }))
}
