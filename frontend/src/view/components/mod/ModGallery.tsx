import { createContext, createSignal, Show, type JSX } from 'solid-js'
import type { MediaReference } from '../../../model/entities/media'
import type { GalleryItem, SourceRect } from '../Gallery/context'
import { GalleryOverlay } from '../Gallery/GalleryOverlay'

export interface ModGalleryApi {
  open: (items: GalleryItem[], index: number, sourceRect?: SourceRect) => void
  close: () => void
}

export const ModGalleryCtx = createContext<ModGalleryApi>({ open: () => { }, close: () => { } })

interface OpenState {
  items: GalleryItem[]
  index: number
  sourceRect: SourceRect | null
}

const keyOf = (reference: MediaReference) => `${reference.postId}:${reference.hash}`

export function ModGalleryProvider(props: { children: JSX.Element }) {
  const [state, setState] = createSignal<OpenState | null>(null)
  const api: ModGalleryApi = {
    open: (items, index, sourceRect) => setState({ items, index, sourceRect: sourceRect ?? null }),
    close: () => setState(null),
  }
  return (
    <ModGalleryCtx.Provider value={api}>
      {props.children}
      <Show when={state()}>
        {(open) => {
          const references = () => open().items.map((item): MediaReference => ({ postId: item.postId, hash: item.hash }))
          const byKey = () => new Map(open().items.map((item) => [keyOf(item), item]))
          return (
            <GalleryOverlay
              items={references()}
              revision={0}
              media={(reference) => (reference ? byKey().get(keyOf(reference)) : undefined)}
              index={open().index}
              sourceRect={open().sourceRect}
              onSelect={(index) => setState((current) => (current ? { ...current, index } : current))}
              onClose={api.close}
            />
          )
        }}
      </Show>
    </ModGalleryCtx.Provider>
  )
}
