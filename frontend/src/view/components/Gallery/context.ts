import { createContext } from 'solid-js'
import type { MediaInfo } from '../../../model/entities/media'

export type GalleryItem = MediaInfo

export interface SourceRect {
  left: number
  top: number
  width: number
  height: number
}

export interface GalleryApi {
  open: (forumId: string, item: GalleryItem, sourceRect?: SourceRect) => void
  close: () => void
}

export const ApiCtx = createContext<GalleryApi>({ open: () => { }, close: () => { } })
