import { produce, type SetStoreFunction } from 'solid-js/store'
import { referenceUpdates } from '../../model/rules/references'
import { referenceKey } from '../../model/selectors/forum'
import type { ForumState } from '../../model/state/forum'

export function createReferenceUpdates(model: ForumState, write: SetStoreFunction<ForumState>) {
  const reindex = (target: string, start: number) => {
    const list = model.references[target]
    for (let index = start; index < list.items.length; index++) {
      const item = list.items[index]
      write('references', target, 'positions', referenceKey(item.forumId!, item.postId), index)
    }
    write('references', target, 'revision', list.revision + 1)
  }
  return (root: string, ids: Iterable<string>, removed = false) => {
    for (const update of referenceUpdates(model, root, ids, removed)) {
      const { source, reference, targets, added, removed } = update
      if (targets) write('outgoing', source, targets)
      else write('outgoing', produce((values) => { delete values[source] }))
      for (const target of removed) {
        const list = model.references[target]
        const index = list?.positions[source]
        if (index === undefined) continue
        write('references', target, 'items', produce((items) => { items.splice(index, 1) }))
        write('references', target, 'positions', produce((positions) => { delete positions[source] }))
        reindex(target, index)
        if (!list.items.length) write('references', produce((values) => { delete values[target] }))
      }
      if (!reference) continue
      for (const target of added) {
        if (!model.references[target]) write('references', target, { items: [], positions: {}, revision: 0 })
        const list = model.references[target]
        const length = list.items.length
        if (!length || list.items[length - 1].number <= reference.number) {
          write('references', target, 'items', length, reference)
          write('references', target, 'positions', source, length)
        } else {
          let low = 0
          let high = length
          while (low < high) {
            const middle = (low + high) >>> 1
            if (list.items[middle].number <= reference.number) low = middle + 1
            else high = middle
          }
          write('references', target, 'items', produce((items) => { items.splice(low, 0, reference) }))
          reindex(target, low)
        }
      }
    }
  }
}
