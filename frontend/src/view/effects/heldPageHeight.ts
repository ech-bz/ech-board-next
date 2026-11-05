import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js'

export function createHeldPageHeight(active: Accessor<boolean>, failed: Accessor<boolean>) {
  const [element, setElement] = createSignal<HTMLElement>()
  const [height, setHeight] = createSignal(0)
  let frame = 0
  const measure = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!active() && !failed()) setHeight(document.documentElement.scrollHeight)
    })
  }
  createEffect(() => {
    const node = element()
    if (!node) return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    window.addEventListener('resize', measure)
    measure()
    onCleanup(() => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    })
  })
  createEffect(() => {
    const holding = active()
    document.documentElement.classList.toggle('no-anchor', holding)
    if (!holding) measure()
  })
  onCleanup(() => {
    if (frame) cancelAnimationFrame(frame)
    document.documentElement.classList.remove('no-anchor')
  })
  return { height, ref: setElement }
}
