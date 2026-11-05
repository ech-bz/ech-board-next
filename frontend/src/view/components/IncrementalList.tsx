import { createRenderEffect, createRoot, createSignal, getOwner, onCleanup, runWithOwner, untrack, type Accessor, type JSX, type Setter } from 'solid-js'
import { insert } from 'solid-js/web'

interface Row<T> {
  key: string
  first: Text
  last: Text
  setValue: Setter<T>
  setIndex: Setter<number>
  dispose: () => void
}

export function IncrementalList<T>(props: {
  each: readonly T[]
  revision: number
  key: (value: T) => string
  children: (value: Accessor<T>, index: Accessor<number>) => JSX.Element
  marker?: { before: string | null; element: HTMLElement }
}) {
  const owner = getOwner()
  const container = document.createElement('div')
  container.style.display = 'contents'
  const rows = new Map<string, Row<T>>()
  let order: Row<T>[] = []
  let source: readonly T[] | undefined
  let revision = -1
  const remove = (row: Row<T>) => {
    row.dispose()
    let node: Node | null = row.first
    while (node) {
      const next: Node | null = node.nextSibling
      container.removeChild(node)
      if (node === row.last) break
      node = next
    }
    rows.delete(row.key)
  }
  const mount = (value: T, position: number): Row<T> => runWithOwner(owner, () => createRoot((dispose) => {
    const first = document.createTextNode('')
    const last = document.createTextNode('')
    const [item, setValue] = createSignal(value)
    const [index, setIndex] = createSignal(position)
    container.append(first, last)
    insert(container, () => props.children(item, index), last)
    const row = { key: props.key(value), first, last, setValue, setIndex, dispose }
    rows.set(row.key, row)
    return row
  }))!
  const placeMarker = () => {
    const marker = props.marker
    if (!marker) return
    const target = marker.before === null ? undefined : rows.get(marker.before)
    if (target && marker.element.nextSibling !== target.first) container.insertBefore(marker.element, target.first)
    else if (target) return
    else marker.element.remove()
  }
  createRenderEffect(() => {
    const items = props.each
    const length = items.length
    const nextRevision = props.revision
    untrack(() => {
      if (source !== undefined && (source !== items || revision !== nextRevision || length < order.length)) {
        const next: Row<T>[] = []
        const kept = new Set<string>()
        for (const value of items) {
          const key = props.key(value)
          const row = rows.get(key) ?? mount(value, next.length)
          row.setValue(() => value)
          row.setIndex(next.length)
          next.push(row)
          kept.add(key)
        }
        for (const row of order) if (!kept.has(row.key)) remove(row)
        for (const row of next) {
          const fragment = document.createDocumentFragment()
          let node: Node | null = row.first
          while (node) {
            const following: Node | null = node.nextSibling
            fragment.append(node)
            if (node === row.last) break
            node = following
          }
          container.append(fragment)
        }
        order = next
      } else {
        for (let index = order.length; index < length; index++) order.push(mount(items[index], index))
      }
      source = items
      revision = nextRevision
      placeMarker()
    })
  })
  createRenderEffect(placeMarker)
  onCleanup(() => {
    for (const row of order) row.dispose()
    rows.clear()
    order = []
    container.replaceChildren()
  })
  return container
}
