import { createEffect, onCleanup, type Accessor } from 'solid-js'
import type { Post } from '../../model/entities/post'

export function observePostGrowth(post: Accessor<Post>, element: Accessor<HTMLElement | undefined>, tooltip: Accessor<boolean>) {
  const sameBubbles = (a: Post['reactions'], b: Post['reactions']): boolean =>
    a.length === b.length && a.every((item, i) => item.hex === b[i].hex && item.count === b[i].count)
  let shownBubbles = post().reactions
  let shownRefs = post().refs.length
  let shownMedia = post().media.length
  let shownText = post().plain.length
  let growPending = false
  let growScrollY = 0
  createEffect(() => {
    const current = post()
    if (
      !sameBubbles(shownBubbles, current.reactions) ||
      shownRefs !== current.refs.length ||
      shownMedia !== current.media.length ||
      shownText !== current.plain.length
    ) {
      growPending = true
      growScrollY = window.scrollY
    }
    shownBubbles = current.reactions
    shownRefs = current.refs.length
    shownMedia = current.media.length
    shownText = current.plain.length
  })
  createEffect(() => {
    const node = element()
    if (!node || tooltip()) return
    let primed = false
    let height = 0
    const observer = new ResizeObserver(() => {
      const rect = node.getBoundingClientRect()
      if (!primed) {
        primed = true
        height = rect.height
        return
      }
      const delta = rect.height - height
      height = rect.height
      if (delta === 0 || !growPending) return
      growPending = false
      if (window.scrollY !== growScrollY) return
      if (delta < 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 0.5) return
      const grownTop = rect.bottom - delta
      if (grownTop >= window.innerHeight || rect.bottom <= 0) return
      window.scrollBy(0, delta)
    })
    observer.observe(node)
    onCleanup(() => observer.disconnect())
  })
}
