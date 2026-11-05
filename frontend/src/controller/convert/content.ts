import type { PostPart } from '../../model/content/postPart'
import { PostPartVec } from '../io/ech/protocol/types'

export function decodePostContent(bytes: Uint8Array): PostPart[] | null {
  try { return PostPartVec.parse(bytes) }
  catch { return null }
}
