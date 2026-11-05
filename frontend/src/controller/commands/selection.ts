import type { ForumQueries } from '../../model/selectors/queries'
import type { ForumState } from '../../model/state/forum'
import type { Commit } from '../commit'
import type { ModActions } from './moderation'

export function createSelectionCommands(model: ForumState, read: ForumQueries, moderation: ModActions, commit: Commit) {
  const clear = () => commit({ type: 'selection.set', value: { ids: [], lastId: null } })
  return {
    clear,
    restrict() {
      const ids = model.selection.ids
      if (!ids.length) return
      const selected = ids.filter((id) => read.postVisible(id, model.preferences.showDeleted))
      if (selected.length !== ids.length) commit({ type: 'selection.set', value: { ids: selected, lastId: selected.length ? model.selection.lastId : null } })
    },
    toggle(id: string, shift: boolean) {
      const ordered = read.postsOf(model.preferences.showDeleted)
      const selected = new Set(model.selection.ids)
      const previous = model.selection.lastId
      const end = ordered.indexOf(id)
      if (end < 0) return
      let start = previous ? ordered.indexOf(previous) : -1
      if (shift && previous && start < 0) {
        let distance = Infinity
        ordered.forEach((candidate, index) => {
          if (selected.has(candidate) && Math.abs(index - end) < distance) {
            distance = Math.abs(index - end)
            start = index
          }
        })
      }
      if (shift && previous && start >= 0) {
        for (let index = Math.min(start, end); index <= Math.max(start, end); index++) selected.add(ordered[index])
      } else if (selected.has(id)) selected.delete(id)
      else selected.add(id)
      commit({ type: 'selection.set', value: { ids: [...selected], lastId: id } })
    },
    selectAuthor(id: string) {
      const author = read.get(id)?.author
      if (!author) return
      const ids = read.postsOf(model.preferences.showDeleted).filter((postId) => read.get(postId)?.author === author)
      commit({ type: 'selection.set', value: { ids: [...new Set([...model.selection.ids, ...ids])], lastId: null } })
    },
    async moderate(action: 'delete' | 'restore') {
      if (model.operations.selectionProgress) return
      const forumId = model.page.forumId
      const threadId = model.page.threadId
      if (!threadId) return
      const posts = model.selection.ids.flatMap((id) => {
        const post = read.get(id)
        return post && post.deleted === (action === 'restore') ? [post] : []
      })
      commit({ type: 'operations.patch', value: { selectionProgress: { done: 0, total: posts.length } } })
      const progress = (done: number, total: number) => commit({ type: 'operations.patch', value: { selectionProgress: { done, total } } })
      try {
        if (action === 'delete') await moderation.runBatchPostDelete(posts, threadId, progress)
        else await moderation.runBatchPostRestore(posts, threadId, progress)
        if (model.page.forumId === forumId && model.page.threadId === threadId) clear()
      } finally {
        commit({ type: 'operations.patch', value: { selectionProgress: null } })
      }
    },
  }
}
