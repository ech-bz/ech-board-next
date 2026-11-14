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
  const [directItem, setDirectItem] = createSignal<GalleryItem | null>(null)
  const [activeForumId, setActiveForumId] = createSignal<string | null>(null)
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
  const items = () => {
    const current = collection().items
    if (current.length) return current
    const selected = model.gallery
    const direct = directItem()
    return selected && direct && selected.postId === direct.postId && selected.hash === direct.hash
      ? [{ postId: direct.postId, hash: direct.hash }]
      : current
  }
  const mediaFor = (reference: { postId: string; hash: string } | undefined) => {
    const selected = model.gallery
    const direct = directItem()
    if (reference && selected && direct && selected.postId === reference.postId && selected.hash === reference.hash && direct.postId === reference.postId && direct.hash === reference.hash) return direct
    return read.galleryMedia(reference)
  }
  createEffect(() => {
    if (model.gallery && items().length === 0) controller.closeGallery()
  })
  const index = () => collection().index >= 0 ? collection().index : 0
  const closeGallery = () => {
    endNativePip()
    setDirectItem(null)
    setActiveForumId(null)
    setResume(null)
    controller.closeGallery()
  }
  const api: GalleryApi = {
    open: (forumId, item, rect) => {
      endNativePip()
      setResume(null)
      setDirectItem(item)
      setActiveForumId(forumId)
      setSourceRect(rect ?? null)
      if (isPlayableMime(item.mime)) setPip(null)
      controller.openGallery(forumId, item.postId, item.hash)
    },
    close: closeGallery,
  }
  const startPip = (item: GalleryItem, media: HTMLMediaElement) => {
    const forumId = activeForumId() ?? model.gallery?.forumId
    if (!forumId) return
    setPip({ forumId, item, media })
    controller.closeGallery()
  }
  const returnToGallery = (state: PipState, media: HTMLMediaElement) => {
    endNativePip()
    setResume({ hash: state.item.hash, media })
    setDirectItem(state.item)
    setActiveForumId(state.forumId)
    setSourceRect(null)
    controller.openGallery(state.forumId, state.item.postId, state.item.hash)
    setPip(null)
  }
  const startNativePip = (media: HTMLMediaElement) => {
    stopNativeWatch?.()
    setHidden(true)
    stopNativeWatch = onNativePipLeave(media, () => {
      endNativePip()
      setDirectItem(null)
      setActiveForumId(null)
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
          media={mediaFor}
          index={index()}
          sourceRect={sourceRect()}
          autoPip={model.preferences.autoPip}
          hidden={hidden()}
          resume={resume()}
          onSelect={(index) => {
            const item = items()[index]
            if (item && model.gallery) controller.openGallery(model.gallery.forumId, item.postId, item.hash)
          }}
          onClose={() => {
            if (hidden()) exitNativePip()
            closeGallery()
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
            onClose={() => {
              setPip(null)
              setDirectItem(null)
              setActiveForumId(null)
            }}
            onToGallery={(_item, media) => returnToGallery(state, media)}
          />
        )}
      </Show>
    </ApiCtx.Provider>
  )
}
