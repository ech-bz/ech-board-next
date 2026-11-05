import { produce, reconcile, type SetStoreFunction } from 'solid-js/store'
import { fromHex, toHex } from '../../model/content/hex'
import { forumKey, numberKey } from '../../model/selectors/forum'
import { initialForumScope, type ForumState } from '../../model/state/forum'
import { convertBoard } from '../convert/board'
import { decodePostContent } from '../convert/content'
import { convertForum } from '../convert/forum'
import { convertPost } from '../convert/post'
import { convertThread } from '../convert/thread'
import { EntityId } from '../io/ech/protocol/entityId'
import type { EntityUpdate } from './entities.types'
import type { EntityLifecycle } from './lifecycle'
import { removePermissionDeadline } from './permissions'
import { createReferenceUpdates } from './references'
import type { PostRetentionPolicy } from './retention'
import { createThreadPostUpdates } from './threadPosts'

export function createEntityUpdates(model: ForumState, write: SetStoreFunction<ForumState>, lifecycle: EntityLifecycle, retention: PostRetentionPolicy) {
  const { attach } = lifecycle
  const updateReferences = createReferenceUpdates(model, write)
  const threadPosts = createThreadPostUpdates(model, write)
  const indexContent = (root: string, id: string, previous: string | null, next: string | null) => {
    if (previous && model.scopes[root].contentPosts[previous]) {
      write('scopes', root, 'contentPosts', previous, produce((ids) => { delete ids[id] }))
      if (!Object.keys(model.scopes[root].contentPosts[previous]).length) write('scopes', root, 'contentPosts', produce((values) => { delete values[previous] }))
    }
    if (next) write('scopes', root, 'contentPosts', next, { [id]: true })
  }
  const indexAttachments = (root: string, id: string, previous: string[], next: string[]) => {
    const scope = model.scopes[root]
    const after = new Set(next)
    for (const hash of previous) {
      if (after.has(hash) || !scope.attachmentPosts[hash]) continue
      write('scopes', root, 'attachmentPosts', hash, produce((ids) => { delete ids[id] }))
      if (!Object.keys(scope.attachmentPosts[hash]).length) write('scopes', root, 'attachmentPosts', produce((values) => { delete values[hash] }))
    }
    const before = new Set(previous)
    for (const hash of next) if (!before.has(hash)) write('scopes', root, 'attachmentPosts', hash, { [id]: true })
  }
  const apply = (changes: EntityUpdate) => {
    const root = forumKey(changes.scope.forumId)
    const previewDependencies = changes.preview ? new Set(changes.preview.dependencies) : null
    if (!model.scopes[root]) {
      const scope = initialForumScope(root, changes.scope.relayUrl)
      write('scopes', root, scope)
    }
    if (root && model.scopes[root]) {
      const scope = model.scopes[root]
      if (scope.relayUrl !== changes.scope.relayUrl) write('scopes', root, 'relayUrl', changes.scope.relayUrl)
      const affected = new Set<string>()
      const contentHashes = new Set<string>()
      const attachmentHashes = new Set<string>()
      for (const [hash, bytes] of changes.contents ?? []) {
        const key = toHex(fromHex(hash))
        if (scope.contents[key]) continue
        const content = bytes.slice()
        write('scopes', root, 'contents', key, content)
        const parts = decodePostContent(content)
        if (parts) write('scopes', root, 'parts', key, parts)
        contentHashes.add(key)
      }
      for (const [hash, media] of changes.attachments ?? []) {
        const key = toHex(fromHex(hash))
        if (!scope.attachments[key]) attachmentHashes.add(key)
        write('scopes', root, 'attachments', key, reconcile({ ...media }))
      }
      for (const entity of changes.forums ?? []) {
        const id = EntityId.forum()
        const current = scope.entities.forums[id]
        if (!current) write('scopes', root, 'entities', 'forums', id, attach(root, () => convertForum(entity, model, root)))
        else if (current.sequence < entity.seq) write('scopes', root, 'entities', 'forums', id, reconcile(convertForum(entity, model, root)))
      }
      for (const entity of changes.boards ?? []) {
        const id = EntityId.board(entity.key.slug)
        const current = scope.entities.boards[id]
        if (!current) write('scopes', root, 'entities', 'boards', id, attach(root, () => convertBoard(entity, model, root)))
        else if (current.sequence < entity.seq) write('scopes', root, 'entities', 'boards', id, reconcile(convertBoard(entity, model, root)))
        write('scopes', root, 'boardIds', entity.key.slug, id)
      }
      for (const entity of changes.threads ?? []) {
        const id = EntityId.thread(entity.key.board, Number(entity.key.number))
        const current = scope.entities.threads[id]
        if (!current) write('scopes', root, 'entities', 'threads', id, attach(root, () => convertThread(entity, model, root)))
        else if (current.sequence < entity.seq) write('scopes', root, 'entities', 'threads', id, reconcile(convertThread(entity, model, root)))
        const thread = scope.entities.threads[id]
        write('scopes', root, 'threadIds', numberKey(thread.board, thread.number), thread.id)
        threadPosts.ensure(root, thread.id)
      }
      const additions = new Map<string, string[]>()
      const changed = new Set<string>()
      for (const entity of changes.posts ?? []) {
        const key = numberKey(entity.key.board, Number(entity.key.number))
        const id = scope.postIds[key] ?? EntityId.post(entity.key.board, Number(entity.key.number))
        previewDependencies?.add(id)
        const current = scope.entities.posts[id]
        if (current && current.sequence >= entity.seq) { retention.track(root, id, changes.retention); continue }
        const previousHash = current?.textHash ? toHex(current.textHash) : null
        const previousMedia = current?.mediaHashes.map(toHex) ?? []
        if (!current) write('scopes', root, 'entities', 'posts', id, attach(root, () => convertPost(entity, model, root, id), id))
        else write('scopes', root, 'entities', 'posts', id, reconcile(convertPost(entity, model, root, id)))
        const post = scope.entities.posts[id]
        changed.add(id)
        indexAttachments(root, id, previousMedia, post.mediaHashes.map(toHex))
        retention.track(root, id, changes.retention)
        const nextHash = post.textHash ? toHex(post.textHash) : null
        if (!current || previousHash !== nextHash) {
          indexContent(root, id, previousHash, nextHash)
          affected.add(id)
        }
        write('scopes', root, 'postIds', key, id)
        const threadKey = numberKey(post.board, post.threadNumber)
        const threadId = scope.threadIds[threadKey] ?? EntityId.thread(post.board, post.threadNumber)
        if (!scope.threadIds[threadKey]) write('scopes', root, 'threadIds', threadKey, threadId)
        if (!current) {
          let ids = additions.get(threadId)
          if (!ids) { ids = []; additions.set(threadId, ids) }
          ids.push(post.id)
        }
      }
      if (contentHashes.size) {
        for (const hash of contentHashes) for (const id of Object.keys(scope.contentPosts[hash] ?? {})) affected.add(id)
      }
      for (const hash of attachmentHashes) for (const id of Object.keys(scope.attachmentPosts[hash] ?? {})) changed.add(id)
      for (const id of affected) changed.add(id)
      threadPosts.apply(root, additions, changed)
      updateReferences(root, affected)
      if (changes.feed) {
        const { boardId, threadIds, next, append } = changes.feed
        const previous = append ? scope.boardPages[boardId]?.threadIds ?? [] : []
        write('scopes', root, 'boardPages', boardId, { threadIds: [...new Set([...previous, ...threadIds])], next })
      }
      if (changes.loadedThread) write('scopes', root, 'loadedThreads', changes.loadedThread, true)
    }
    if (changes.preview) write('previews', changes.preview.id, { ...changes.preview, dependencies: [...previewDependencies!] })
  }

  const remove = (root: string, ids: string[]) => {
    const scope = model.scopes[root]
    const threads = new Set<string>()
    for (const id of ids) {
      const post = scope.entities.posts[id]
      if (!post) continue
      const thread = scope.threadIds[numberKey(post.board, post.threadNumber)]
      if (thread) threads.add(thread)
      indexContent(root, id, post.textHash ? toHex(post.textHash) : null, null)
      indexAttachments(root, id, post.mediaHashes.map(toHex), [])
      write('scopes', root, 'postIds', produce((values) => { delete values[numberKey(post.board, post.number)] }))
      write('scopes', root, 'entities', 'posts', produce((posts) => { delete posts[id] }))
      lifecycle.releasePost(root, id)
      removePermissionDeadline(model, write, root, id)
    }
    const removed = new Set(ids)
    for (const thread of threads) threadPosts.remove(root, thread, removed)
    updateReferences(root, ids)
  }
  const removeScope = (root: string) => {
    const scope = model.scopes[root]
    if (!scope) return
    updateReferences(root, Object.keys(scope.entities.posts), true)
    lifecycle.releaseScope(root)
    write('scopes', produce((scopes) => { delete scopes[root] }))
  }
  const reset = () => {
    for (const root of Object.keys(model.scopes)) lifecycle.releaseScope(root)
    write('scopes', reconcile({}))
    write('references', reconcile({}))
    write('outgoing', reconcile({}))
  }
  return { apply, remove, removeScope, reset }
}
