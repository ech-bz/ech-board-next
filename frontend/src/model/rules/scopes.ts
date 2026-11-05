import { forumKey } from '../selectors/forum'
import type { ForumState } from '../state/forum'

export function heldForumRoots(model: ForumState): Set<string> {
  const roots = new Set<string>()
  const hold = (root: string | null | undefined) => { if (root) roots.add(forumKey(root)) }
  hold(model.navigation.context?.forumId)
  hold(model.page.forumId)
  hold(model.gallery?.forumId)
  for (const preview of Object.values(model.previews)) hold(preview.forumId)
  for (const draft of Object.values(model.drafts)) hold(draft.editing?.forumId)
  return roots
}
