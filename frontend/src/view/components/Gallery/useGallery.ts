import { useContext } from 'solid-js'
import { ApiCtx, type GalleryItem, type SourceRect } from './context'

export function useGallery(forumId: () => string) {
  const api = useContext(ApiCtx)
  const openMedia = (item: GalleryItem, sourceRect?: SourceRect) => api.open(forumId(), item, sourceRect)
  return { openMedia }
}
