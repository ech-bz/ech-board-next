import type { PostPart } from './postPart'
import { toHex } from './hex'
import { referenceKey } from '../selectors/forum'

export function replyTargets(parts: readonly PostPart[], targets = new Set<string>()): Set<string> {
  for (const part of parts) {
    if ('ReplyTo' in part) targets.add(referenceKey(toHex(part.ReplyTo.forum), toHex(part.ReplyTo.post)))
    else if ('Link' in part) replyTargets(part.Link.children, targets)
    else if ('Fold' in part) replyTargets(part.Fold.children, targets)
    else {
      for (const value of Object.values(part)) if (Array.isArray(value)) replyTargets(value, targets)
    }
  }
  return targets
}

