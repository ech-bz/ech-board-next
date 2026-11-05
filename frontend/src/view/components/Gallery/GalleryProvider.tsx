import { createEffect, createMemo, createSignal, Show, type JSX } from 'solid-js'
import { useForumController, useForumModel, useForumQueries } from '../../bindings/forum'
import { ApiCtx, type GalleryApi, type SourceRect } from './context'
import { GalleryOverlay } from './GalleryOverlay'

export function GalleryProvider(props: { children: JSX.Element }) {
  const model = useForumModel()
  const controller = useForumController()
  const read = useForumQueries()
  const [sourceRect, setSourceRect] = createSignal<SourceRect | null>(null)
  const collection = createMemo(read.galleryCollection)
  const items = () => collection().items
  createEffect(() => {
    if (model.gallery && items().length === 0) controller.closeGallery()
  })
  const index = () => collection().index
  const api: GalleryApi = {
    open: (forumId, postId, hash, rect) => {
      setSourceRect(rect ?? null)
      controller.openGallery(forumId, postId, hash)
    },
    close: controller.closeGallery,
  }
  return (
    <ApiCtx.Provider value={api}>
      {props.children}
      <Show when={model.gallery && items().length > 0}>
        <GalleryOverlay
          items={items()}
          revision={collection().revision}
          media={read.galleryMedia}
          index={index()}
          sourceRect={sourceRect()}
          onSelect={(index) => {
            const item = items()[index]
            if (item && model.gallery) controller.openGallery(model.gallery.forumId, item.postId, item.hash)
          }}
          onClose={controller.closeGallery}
        />
      </Show>
    </ApiCtx.Provider>
  )
}
