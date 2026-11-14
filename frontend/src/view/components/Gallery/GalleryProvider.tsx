import { createEffect, createMemo, createSignal, Show, type JSX } from 'solid-js'
import { useForumController, useForumModel, useForumQueries } from '../../bindings/forum'
import { MediaPlayer, isPlayableMime } from '../Player/MediaPlayer'
import { exitNativePip, onNativePipLeave } from '../Player/nativePip'
import { ApiCtx, type GalleryApi, type GalleryItem, type SourceRect } from './context'
import { GalleryOverlay } from './GalleryOverlay'

interface PipState {
  forumId: string
  item: GalleryItem
  media: HTMLMediaElement
}

export function GalleryProvider(props: { children: JSX.Element }) {
  const model = useForumModel()
  const controller = useForumController()
  const read = useForumQueries()
  const [sourceRect, setSourceRect] = createSignal<SourceRect | null>(null)
  const [pip, setPip] = createSignal<PipState | null>(null)
  const [hidden, setHidden] = createSignal(false)
  const [resume, setResume] = createSignal<{ hash: string; media: HTMLMediaElement } | null>(null)
  let stopNativeWatch: (() => void) | null = null
  const endNativePip = () => {
    stopNativeWatch?.()
    stopNativeWatch = null
    setHidden(false)
  }
  const collection = createMemo(read.galleryCollection)
  const items = () => collection().items
  createEffect(() => {
    if (model.gallery && items().length === 0) controller.closeGallery()
  })
  const index = () => collection().index
  const api: GalleryApi = {
    open: (forumId, postId, hash, rect) => {
      const item = read.galleryMedia({ postId, hash })
      if (item && isPlayableMime(item.mime)) setPip(null)
      endNativePip()
      setResume(null)
      setSourceRect(rect ?? null)
      controller.openGallery(forumId, postId, hash)
    },
    close: () => {
      endNativePip()
      controller.closeGallery()
    },
  }
  const startPip = (item: GalleryItem, media: HTMLMediaElement) => {
    const forumId = model.gallery?.forumId
    if (!forumId) return
    setPip({ forumId, item, media })
    controller.closeGallery()
  }
  const returnToGallery = (state: PipState) => {
    endNativePip()
    setResume({ hash: state.item.hash, media: state.media })
    setSourceRect(null)
    controller.openGallery(state.forumId, state.item.postId, state.item.hash)
    setPip(null)
  }
  const startNativePip = (media: HTMLMediaElement) => {
    stopNativeWatch?.()
    setHidden(true)
    stopNativeWatch = onNativePipLeave(media, () => {
      endNativePip()
      controller.closeGallery()
    })
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
          hidden={hidden()}
          resume={resume()}
          onSelect={(index) => {
            const item = items()[index]
            if (item && model.gallery) controller.openGallery(model.gallery.forumId, item.postId, item.hash)
          }}
          onClose={() => {
            if (hidden()) exitNativePip()
            endNativePip()
            controller.closeGallery()
          }}
          onPip={startPip}
          onNativePip={startNativePip}
        />
      </Show>
      <Show when={pip()} keyed>
        {(state) => (
          <MediaPlayer
            floating
            item={state.item}
            adopt={state.media}
            onClose={() => setPip(null)}
            onToGallery={() => returnToGallery(state)}
          />
        )}
      </Show>
    </ApiCtx.Provider>
  )
}
