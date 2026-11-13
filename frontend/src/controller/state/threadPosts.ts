import { produce, type SetStoreFunction } from 'solid-js/store'
import { mergePostOrder } from '../../model/rules/postOrder'
import { postContribution } from '../../model/rules/postVisibility'
import type { ForumState } from '../../model/state/forum'
import { emptyThreadPosts } from '../../model/state/threadPosts'

export function createThreadPostUpdates(model: ForumState, write: SetStoreFunction<ForumState>) {
  const ensure = (root: string, threadId: string) => {
    if (!model.scopes[root].threadPosts[threadId]) write('scopes', root, 'threadPosts', threadId, emptyThreadPosts())
    return model.scopes[root].threadPosts[threadId]
  }
  const reindex = (root: string, threadId: string, start: number) => {
    const scope = model.scopes[root]
    const list = scope.threadPosts[threadId]
    const previous = start ? list.positions[list.ids[start - 1]] : null
    let ready = previous?.readyCount ?? 0
    let visible = previous?.visibleCount ?? 0
    let ordinal = previous?.ordinal ?? 0
    let mediaCount = previous?.mediaCount ?? 0
    let visibleMediaCount = previous?.visibleMediaCount ?? 0
    if (list.positions[list.ids[start]]) write('scopes', root, 'threadPosts', threadId, 'mediaRevision', list.mediaRevision + 1)
    for (let position = start; position < list.ids.length; position++) {
      const id = list.ids[position]
      const post = scope.entities.posts[id]
      const contribution = postContribution(post)
      if (contribution.counted) ordinal++
      for (const reference of contribution.media) {
        write('scopes', root, 'threadPosts', threadId, 'media', mediaCount++, reference)
        if (contribution.visible) write('scopes', root, 'threadPosts', threadId, 'visibleMedia', visibleMediaCount++, { ...reference })
      }
      write('scopes', root, 'threadPosts', threadId, 'positions', id, {
        position,
        ordinal,
        readyCount: ready + Number(contribution.ready),
        visibleCount: visible + Number(contribution.visible),
        mediaCount,
        visibleMediaCount,
      })
      if (contribution.ready) write('scopes', root, 'threadPosts', threadId, 'readyIds', ready++, id)
      if (contribution.visible) write('scopes', root, 'threadPosts', threadId, 'visibleIds', visible++, id)
    }
    write('scopes', root, 'threadPosts', threadId, 'readyIds', produce((ids) => { ids.length = ready }))
    write('scopes', root, 'threadPosts', threadId, 'visibleIds', produce((ids) => { ids.length = visible }))
    write('scopes', root, 'threadPosts', threadId, 'media', produce((items) => { items.length = mediaCount }))
    write('scopes', root, 'threadPosts', threadId, 'visibleMedia', produce((items) => { items.length = visibleMediaCount }))
  }
  const apply = (root: string, additions: Map<string, string[]>, changed: Iterable<string>) => {
    const scope = model.scopes[root]
    const starts = new Map<string, number>()
    for (const [threadId, ids] of additions) {
      const list = ensure(root, threadId)
      ids.sort((left, right) => scope.entities.posts[left].number - scope.entities.posts[right].number)
      const length = list.ids.length
      if (!length || scope.entities.posts[ids[0]].number > scope.entities.posts[list.ids[length - 1]].number) {
        for (let index = 0; index < ids.length; index++) write('scopes', root, 'threadPosts', threadId, 'ids', length + index, ids[index])
        starts.set(threadId, length)
      } else {
        write('scopes', root, 'threadPosts', threadId, 'ids', mergePostOrder(list.ids, ids, scope.entities.posts))
        write('scopes', root, 'threadPosts', threadId, 'revision', list.revision + 1)
        write('scopes', root, 'threadPosts', threadId, 'mediaRevision', list.mediaRevision + 1)
        starts.set(threadId, 0)
      }
    }
    for (const id of changed) {
      const post = scope.entities.posts[id]
      const threadId = post.threadId
      const list = scope.threadPosts[threadId]
      const entry = list?.positions[id]
      if (!entry || starts.get(threadId) === 0) continue
      const previous = entry.position ? list.positions[list.ids[entry.position - 1]] : null
      const contribution = postContribution(post)
      const media = contribution.media
      const offset = previous?.mediaCount ?? 0
      const sameMedia = entry.mediaCount - offset === media.length && media.every((item, index) => list.media[offset + index].hash === item.hash)
      if (sameMedia && (entry.readyCount > (previous?.readyCount ?? 0)) === contribution.ready && (entry.ordinal > (previous?.ordinal ?? 0)) === contribution.counted) continue
      starts.set(threadId, Math.min(starts.get(threadId) ?? entry.position, entry.position))
    }
    for (const [threadId, start] of starts) reindex(root, threadId, start)
  }
  const remove = (root: string, threadId: string, removed: Set<string>) => {
    const list = model.scopes[root].threadPosts[threadId]
    if (!list) return
    write('scopes', root, 'threadPosts', threadId, 'ids', list.ids.filter((id) => !removed.has(id)))
    write('scopes', root, 'threadPosts', threadId, 'positions', produce((positions) => { for (const id of removed) delete positions[id] }))
    write('scopes', root, 'threadPosts', threadId, 'revision', list.revision + 1)
    reindex(root, threadId, 0)
  }
  return { ensure, apply, remove }
}
