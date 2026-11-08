import { cva } from 'class-variance-authority'
import { createEffect, createSignal, onCleanup, Show, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import { EllipsisIcon } from '../../icons/EllipsisIcon'
import { IconButton } from '../IconButton'
import { MenuItems, type MenuItem } from './MenuItems'

export type { MenuItem }

interface Position {
  top: number
  right?: number
  left?: number
}

export function DropdownMenu(props: {
  items: MenuItem[]
  postTrigger?: boolean
  hasItems?: boolean
  class?: string
  iconSize?: number
  triggerShape?: 'circle' | 'rounded' | 'square'
  triggerSize?: 'xs' | 'sm' | 'md' | 'lg'
  triggerVariant?: 'glass'
  icon?: JSX.Element
  ariaLabel?: string
}) {
  const [open, setOpen] = createSignal(false)
  const [pos, setPos] = createSignal<Position | null>(null)
  let button: HTMLButtonElement | undefined
  let menu: HTMLDivElement | undefined

  const toggle = () => {
    const rect = button?.getBoundingClientRect()
    if (!open() && rect) setPos({ top: rect.bottom + 2, right: window.innerWidth - rect.right })
    setOpen(!open())
  }

  return (
    <Show when={props.hasItems ?? props.items.length > 0}>
      <Show when={props.postTrigger} fallback={<IconButton
        ref={button}
        size={props.triggerSize ?? 'lg'}
        variant={props.triggerVariant}
        shape={props.triggerShape}
        class={props.class}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          toggle()
        }}
        aria-label={props.ariaLabel ?? 'menu'}
      >
        <Show when={props.icon} fallback={<EllipsisIcon width={props.iconSize ?? 16} height={props.iconSize ?? 16} />}>
          {props.icon}
        </Show>
      </IconButton>}>
        <button
          ref={button}
          type="button"
          class="flex-none inline-flex items-center justify-center text-fg border-0 cursor-pointer disabled:opacity-45 disabled:cursor-default size-4 rounded-md ml-auto self-start"
          aria-label="menu"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle() }}
        ><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#icon-ellipsis" /></svg></button>
      </Show>
      <Show when={open() && pos()}>{(_opened) => {
        createEffect(() => {
          if (!open()) return
          const onDocClick = (e: MouseEvent) => {
            const target = e.target as Node
            if (button?.contains(target) || menu?.contains(target)) return
            setOpen(false)
          }
          const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false)
          }
          const onScroll = () => setOpen(false)
          document.addEventListener('mousedown', onDocClick)
          document.addEventListener('keydown', onKey)
          window.addEventListener('scroll', onScroll, true)
          window.addEventListener('resize', onScroll)
          onCleanup(() => {
            document.removeEventListener('mousedown', onDocClick)
            document.removeEventListener('keydown', onKey)
            window.removeEventListener('scroll', onScroll, true)
            window.removeEventListener('resize', onScroll)
          })
        })

        createEffect(() => {
          const current = pos()
          if (!open() || !current || !menu || !button) return
          const menuHeight = menu.offsetHeight
          const menuWidth = menu.offsetWidth
          const rect = button.getBoundingClientRect()
          const composerHeight = document.querySelector<HTMLElement>('[data-composer]')?.offsetHeight ?? 65
          const safeBottom = window.innerHeight - composerHeight
          const belowTop = rect.bottom + 2
          let top = current.top
          let right = current.right
          let left = current.left
          if (Math.abs(current.top - belowTop) < 1) {
            const aboveTop = rect.top - menuHeight - 2
            if (current.top + menuHeight > safeBottom && aboveTop >= 8) top = aboveTop
          }
          if (right != null && window.innerWidth - right - menuWidth < 8) {
            right = undefined
            left = rect.left
          }
          if (top !== current.top || right !== current.right || left !== current.left) setPos({ top, right, left })
        })

        return (
          <Portal>
            <div
              ref={menu}
              class={'fixed z-overlay flex min-w-menu flex-col gap-0.5 rounded-lg border border-separator bg-active p-1'}
              style={{ top: `${pos()!.top}px`, right: pos()!.right != null ? `${pos()!.right}px` : 'auto', left: pos()!.left != null ? `${pos()!.left}px` : 'auto' }}
              onClick={(e) => e.stopPropagation()}
            >
              <MenuItems items={props.items} onDone={() => setOpen(false)} />
            </div>
          </Portal>
        )
      }}</Show>
    </Show>
  )
}
