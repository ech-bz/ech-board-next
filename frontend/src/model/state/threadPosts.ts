import type { MediaReference } from '../entities/media'

export interface ThreadPostPosition {
  position: number
  ordinal: number
  readyCount: number
  visibleCount: number
  mediaCount: number
  visibleMediaCount: number
}

export interface ThreadPosts {
  ids: string[]
  readyIds: string[]
  visibleIds: string[]
  media: MediaReference[]
  visibleMedia: MediaReference[]
  positions: Record<string, ThreadPostPosition>
  revision: number
  mediaRevision: number
}

export function emptyThreadPosts(): ThreadPosts {
  return { ids: [], readyIds: [], visibleIds: [], media: [], visibleMedia: [], positions: {}, revision: 0, mediaRevision: 0 }
}
