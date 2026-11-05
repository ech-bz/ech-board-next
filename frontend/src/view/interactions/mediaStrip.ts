import { createEffect, createSignal, onCleanup } from 'solid-js'

const MEDIA_FADE = 48
const MEDIA_THUMB_MIN = 24

export function createMediaStrip() {
  const [mediaEl, setMediaEl] = createSignal<HTMLDivElement | null>(null)
  const coarsePointer = window.matchMedia('(pointer: coarse)')
  const [mediaBox, setMediaBox] = createSignal({ left: 0, client: 0, scroll: 0 })
  const [mediaDragging, setMediaDragging] = createSignal(false)
  let mediaDrag: { x: number; left: number; moved: boolean } | null = null
  let mediaThumbDrag: { x: number; left: number } | null = null
  let mediaSuppressClick = false
  const mediaMax = () => Math.max(0, mediaBox().scroll - mediaBox().client)
  const syncMediaBox = () => {
    const el = mediaEl()
    if (!el) return
    const scroll = el.scrollWidth
    const max = Math.max(0, scroll - el.clientWidth)
    setMediaBox({ left: Math.min(Math.max(el.scrollLeft, 0), max), client: el.clientWidth, scroll })
  }
  const mediaMask = () => {
    const box = mediaBox()
    if (box.scroll <= box.client) return undefined
    const start = box.left > 1
    const end = box.left < box.scroll - box.client - 1
    if (!start && !end) return undefined
    const left = `transparent 0, #000 ${MEDIA_FADE}px`
    const right = `#000 calc(100% - ${MEDIA_FADE}px), transparent 100%`
    if (start && end) return `linear-gradient(to right, ${left}, ${right})`
    if (end) return `linear-gradient(to right, #000 0, ${right})`
    return `linear-gradient(to right, ${left}, #000 100%)`
  }
  const mediaThumbGeom = () => {
    const box = mediaBox()
    const max = mediaMax()
    if (max <= 0) return null
    const width = Math.max(MEDIA_THUMB_MIN, (box.client / box.scroll) * box.client)
    return { width, x: (box.left / max) * (box.client - width) }
  }
  const onMediaPointerDown = (e: PointerEvent) => {
    const el = mediaEl()
    if (coarsePointer.matches || !el || e.button !== 0 || mediaMax() <= 0) return
    mediaSuppressClick = false
    mediaDrag = { x: e.clientX, left: el.scrollLeft, moved: false }
  }
  const onMediaPointerMove = (e: PointerEvent) => {
    const el = mediaEl()
    const drag = mediaDrag
    if (!el || !drag) return
    const dx = e.clientX - drag.x
    if (!drag.moved) {
      if (Math.abs(dx) < 4) return
      drag.moved = true
      setMediaDragging(true)
      el.setPointerCapture(e.pointerId)
    }
    el.scrollLeft = drag.left - dx
  }
  const onMediaPointerUp = (e: PointerEvent) => {
    const el = mediaEl()
    const drag = mediaDrag
    mediaDrag = null
    if (el && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    if (drag?.moved) mediaSuppressClick = true
    setMediaDragging(false)
  }
  const onMediaClickCapture = (e: MouseEvent) => {
    if (!mediaSuppressClick) return
    mediaSuppressClick = false
    e.preventDefault()
    e.stopPropagation()
  }
  const onThumbPointerDown = (e: PointerEvent) => {
    if (coarsePointer.matches || e.button !== 0 || mediaMax() <= 0) return
    mediaThumbDrag = { x: e.clientX, left: mediaBox().left }
    e.currentTarget instanceof HTMLElement && e.currentTarget.setPointerCapture(e.pointerId)
    e.stopPropagation()
  }
  const onThumbPointerMove = (e: PointerEvent) => {
    const el = mediaEl()
    const drag = mediaThumbDrag
    const geom = mediaThumbGeom()
    if (!el || !drag || !geom) return
    const span = mediaBox().client - geom.width
    if (span <= 0) return
    el.scrollLeft = drag.left + ((e.clientX - drag.x) / span) * mediaMax()
  }
  const onThumbPointerUp = (e: PointerEvent) => {
    mediaThumbDrag = null
    const target = e.currentTarget
    if (target instanceof HTMLElement && target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId)
  }
  createEffect(() => {
    const el = mediaEl()
    if (!el) return
    const observer = new ResizeObserver(syncMediaBox)
    observer.observe(el)
    el.addEventListener('scroll', syncMediaBox, { passive: true })
    el.addEventListener('click', onMediaClickCapture, true)
    syncMediaBox()
    onCleanup(() => {
      observer.disconnect()
      el.removeEventListener('scroll', syncMediaBox)
      el.removeEventListener('click', onMediaClickCapture, true)
    })
  })
  return { setMediaEl, mediaDragging, mediaMask, mediaThumbGeom, onMediaPointerDown, onMediaPointerMove, onMediaPointerUp, onThumbPointerDown, onThumbPointerMove, onThumbPointerUp }
}
