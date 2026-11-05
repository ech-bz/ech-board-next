import { cva } from 'class-variance-authority'
import { createSignal, onCleanup, Show } from 'solid-js'

import type { Accessor } from 'solid-js'
import { useForumQueries } from '../../bindings/forum'
import { PostBody } from '../Post'
import type { PostTooltipTarget } from './usePostTooltip'

export interface Entry {
  id: number
  anchor: HTMLElement
  target: PostTooltipTarget
}

const tooltipLayerVariants = cva('absolute z-tooltip w-max transition-opacity duration-[150ms]', {
  variants: {
    hidden: {
      true: 'invisible',
    },
    shown: {
      true: 'opacity-100',
      false: 'opacity-0',
    },
    closing: {
      true: 'pointer-events-none',
    },
  },
})
const tooltipLoadingVariants = cva('h-6 w-tooltip')
const TOOLTIP_OFFSET_X = 24

export function TooltipLayer(props: {
  entry: Entry
  register: (el: HTMLElement | null) => void
  boardPage?: boolean
  closing?: Accessor<boolean>
}) {
  const read = useForumQueries()
  let root: HTMLDivElement | undefined
  const [pos, setPos] = createSignal<{ left: number; top: number } | null>(null)
  const [shown, setShown] = createSignal(false)
  const enter = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)))

  onCleanup(() => cancelAnimationFrame(enter))

  const edges = (el: HTMLElement) => {
    const content = el.firstElementChild instanceof HTMLElement ? el.firstElementChild : el
    const tr = content.getBoundingClientRect()
    let bottom = tr.bottom
    let right = tr.right
    for (const over of el.querySelectorAll<HTMLElement>('[data-overhang]')) {
      const r = over.getBoundingClientRect()
      bottom = Math.max(bottom, r.bottom)
      right = Math.max(right, r.right)
    }
    return { tr, bottom, right }
  }

  const wall = () => {
    const el = document.querySelector<HTMLElement>('[data-post-column]') ?? document.querySelector('main')
    if (!el) return { left: 0, right: window.innerWidth }
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return { left: r.left + parseFloat(cs.paddingLeft), right: r.right - parseFloat(cs.paddingRight) }
  }

  const measure = () => {
    if (!root) return
    const el = root
    const ar = props.entry.anchor.getBoundingClientRect()
    const { left: wallLeft, right: wallRight } = wall()
    const { tr, bottom, right } = edges(el)
    const width = tr.width
    const overhang = Math.max(0, right - tr.right)
    const maxWidthCss = `min(var(--post-max-w), ${Math.max(0, wallRight - wallLeft)}px)`
    if (el.style.maxWidth !== maxWidthCss) el.style.maxWidth = maxWidthCss
    const outerHeight = bottom - tr.top
    const header = [...document.querySelectorAll<HTMLElement>('[data-page-header]')].find((h) => h.offsetHeight > 0)
    const topLimit = header ? header.getBoundingClientRect().bottom + 8 : 8
    let bottomLimit = window.innerHeight - 8
    for (const b of document.querySelectorAll<HTMLElement>('[data-composer], [data-tabs]')) {
      if (b.offsetHeight === 0) continue
      const r = b.getBoundingClientRect()
      if (r.top > topLimit && r.top < bottomLimit) bottomLimit = r.top
    }
    const top = ar.bottom + outerHeight > bottomLimit ? ar.top - outerHeight : ar.bottom
    const left = Math.max(wallLeft, Math.min(ar.left + TOOLTIP_OFFSET_X, wallRight - width - overhang))
    setPos({ left: left + window.scrollX, top: top + window.scrollY })
  }

  window.addEventListener('resize', measure)
  const observer = new ResizeObserver(measure)
  onCleanup(() => {
    window.removeEventListener('resize', measure)
    observer.disconnect()
  })

  const post = () => read.previewPost(props.entry.id)
  const context = () => read.previewContext(props.entry.id)
  const slug = () => context()?.slug
  const threadNum = () => context()?.thread.number
  const closed = () => context()?.thread.closed ?? false
  const broom = () => {
    const rec = post()
    return !!rec && rec.op && rec.role === 'mop'
  }

  return (
    <div
      ref={(el) => {
        root = el
        props.register(el)
        if (el) {
          observer.observe(el)
          const parent = props.entry.anchor.closest<HTMLElement>('[data-tooltip-layer]')
          if (parent) observer.observe(parent)
        }
        measure()
      }}
      data-tooltip-layer=""
      class={tooltipLayerVariants({ hidden: !pos(), shown: shown() && !props.closing?.(), closing: props.closing?.() })}
      style={pos() ? { left: `${pos()!.left}px`, top: `${pos()!.top}px` } : undefined}
    >
      <Show when={post()} fallback={<div class={tooltipLoadingVariants()} />}>
        {(rec) => (
          <PostBody
            post={rec()}
            ctx={{

              relayUrl: context()!.relayUrl,
              forumId: context()!.forumId,
              boardId: context()!.boardId,
            }}
            threadClosed={closed()}
            threadBroom={broom()}
            slug={slug()}
            threadNum={threadNum()}
            boardPage={props.boardPage}
            tooltip
          />
        )}
      </Show>
    </div>
  )
}
