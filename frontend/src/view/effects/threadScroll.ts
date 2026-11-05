import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js'
import { scrollToPost } from './scroll'

export interface ViewportObservation {
  y: number
  edge: number
  visible: boolean
}

type ScrollIntent = { target: 'top' | 'bottom'; animated: boolean } | { target: 'post'; number: number }

export function createThreadScroll(total: Accessor<number>, revision: Accessor<number>, hash: Accessor<string>) {
  const [viewport, setViewport] = createSignal<ViewportObservation>({ y: 0, edge: 0, visible: document.visibilityState === 'visible' })
  let frame = 0
  let intent: ScrollIntent | null = null
  let following = false
  let previousTotal = 0
  let previousRevision = revision()
  let lastFollowAt = 0
  let lastEdge: number | null = null
  let attemptedFrom: number | null = null

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update)
  }
  const request = (next: ScrollIntent) => {
    intent = next
    attemptedFrom = null
    schedule()
  }
  const stopFollowing = () => {
    intent = null
    following = false
    attemptedFrom = null
  }
  const update = () => {
    frame = 0
    const y = window.scrollY
    const edge = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    const visible = document.visibilityState === 'visible'
    if (!visible) {
      setViewport({ y, edge, visible })
      return
    }
    const bottom = y >= edge - 8
    if (!intent && bottom) following = true
    if (!intent && following && lastEdge !== null && previousTotal > 0 && edge > lastEdge) intent = { target: 'bottom', animated: false }
    lastEdge = edge
    setViewport({ y, edge, visible })
    const next = intent
    if (!next) return
    if (next.target === 'post') {
      intent = null
      scrollToPost(next.number)
      return
    }
    const target = next.target === 'top' ? 0 : edge
    const delta = target - y
    if (Math.abs(delta) <= 1 || attemptedFrom === y) { intent = null; attemptedFrom = null; return }
    if (!next.animated || Math.abs(delta) > 150) {
      intent = null
      attemptedFrom = null
      window.scrollTo(0, target)
      schedule()
      return
    }
    attemptedFrom = y
    window.scrollTo(0, y + Math.sign(delta) * Math.min(Math.abs(delta), Math.max(6, Math.abs(delta) * 0.25)))
    schedule()
  }
  const yieldScroll = (event: Event) => {
    const target = event.target
    if (target instanceof HTMLElement && (target.matches('input, textarea') || target.isContentEditable)) return
    if (event instanceof KeyboardEvent && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return
    stopFollowing()
  }
  const yieldBar = (event: PointerEvent) => {
    if (event.clientX >= document.documentElement.clientWidth) stopFollowing()
  }
  const observer = new ResizeObserver(schedule)
  observer.observe(document.body)
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
  window.addEventListener('wheel', yieldScroll, { passive: true })
  window.addEventListener('touchstart', yieldScroll, { passive: true })
  window.addEventListener('keydown', yieldScroll)
  document.addEventListener('pointerdown', yieldBar, { passive: true })
  document.addEventListener('visibilitychange', schedule)
  createEffect(() => {
    const count = total()
    const currentRevision = revision()
    const previous = previousTotal
    const missed = currentRevision !== previousRevision
    previousTotal = count
    previousRevision = currentRevision
    if (previous === 0) {
      following = false
      lastEdge = null
      schedule()
      return
    }
    if (missed) { stopFollowing(); schedule(); return }
    if (count > previous && following) {
      const now = performance.now()
      request({ target: 'bottom', animated: now - lastFollowAt > 250 })
      lastFollowAt = now
    } else schedule()
  })
  createEffect(() => {
    const number = Number.parseInt(hash().replace(/^#/, ''), 10)
    if (!Number.isFinite(number)) return
    stopFollowing()
    request({ target: 'post', number })
  })
  onCleanup(() => {
    observer.disconnect()
    if (frame) cancelAnimationFrame(frame)
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    window.removeEventListener('wheel', yieldScroll)
    window.removeEventListener('touchstart', yieldScroll)
    window.removeEventListener('keydown', yieldScroll)
    document.removeEventListener('pointerdown', yieldBar)
    document.removeEventListener('visibilitychange', schedule)
  })
  return {
    viewport,
    atTop: () => viewport().y <= 1,
    atEnd: () => viewport().y >= viewport().edge - 8,
    up() { stopFollowing(); request({ target: 'top', animated: false }) },
    down() { following = true; request({ target: 'bottom', animated: false }) },
  }
}
