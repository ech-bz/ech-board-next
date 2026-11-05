import { createEffect, onCleanup, type Accessor } from 'solid-js'

export function createPostSwipe(element: Accessor<HTMLElement | undefined>, allowed: Accessor<boolean>, reply: () => void) {
  let swipe: { x: number; y: number; mode: 'pending' | 'swipe' | 'vertical'; el: HTMLElement | null } | null = null
  let swipeAnim: Animation | null = null
  const springBack = (element: HTMLElement | null) => {
    if (!element) return
    if (swipeAnim) swipeAnim.cancel()
    swipeAnim = element.animate([{ transform: element.style.transform }, { transform: 'translateX(0px)' }], { duration: 260, easing: 'ease-out' })
    swipeAnim.onfinish = () => {
      element.style.transform = ''
    }
  }
  const onTouchStart = (e: TouchEvent) => {
    swipe = null
    if (!allowed()) return
    const target = e.target
    const carousel = target instanceof Element ? target.closest<HTMLElement>('[data-media-row]') : null
    if (carousel && carousel.scrollWidth > carousel.clientWidth) return
    const touch = e.touches[0]
    if (!touch) return
    if (swipeAnim) {
      swipeAnim.cancel()
      swipeAnim = null
    }
    swipe = { x: touch.clientX, y: touch.clientY, mode: 'pending', el: e.currentTarget as HTMLElement }
  }
  createEffect(() => {
    const el = element()
    if (!el || !allowed()) return
    const onMove = (e: TouchEvent) => {
      const s = swipe
      if (!s || s.mode === 'vertical') return
      const touch = e.touches[0]
      if (!touch) return
      const dx = touch.clientX - s.x
      const dy = touch.clientY - s.y
      if (s.mode === 'pending') {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return
        s.mode = dx < 0 && -dx > Math.abs(dy) * 1.5 ? 'swipe' : 'vertical'
        if (s.mode === 'vertical') return
      }
      if (!s.el) return
      const raw = dx < -110 ? -110 + (dx + 110) * 0.3 : dx > 110 ? 110 + (dx - 110) * 0.3 : dx
      s.el.style.transform = `translateX(${Math.min(raw, 0)}px)`
    }
    el.addEventListener('touchmove', onMove, { passive: true })
    onCleanup(() => el.removeEventListener('touchmove', onMove))
  })
  const onTouchEnd = (e: TouchEvent) => {
    const s = swipe
    if (!s) return
    swipe = null
    const touch = e.changedTouches[0]
    const dx = touch ? touch.clientX - s.x : 0
    if (s.mode === 'swipe' && -dx > 70) reply()
    springBack(s.el)
  }
  const onTouchCancel = () => {
    if (!swipe) return
    springBack(swipe.el)
    swipe = null
  }
  onCleanup(() => swipeAnim?.cancel())
  return { onTouchStart, onTouchEnd, onTouchCancel }
}
