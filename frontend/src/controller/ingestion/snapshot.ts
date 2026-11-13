import { numberKey } from '../../model/selectors/forum'
import type { ForumState } from '../../model/state/forum'
import { requiredResources } from '../convert/resources'
import { postValue, threadValue } from '../convert/versions'
import { EntityId } from '../io/ech/protocol/entityId'
import type { EntityUpdate } from '../state/entities.types'

function latest<T extends { history: { length: bigint } }>(entities: Iterable<T>, key: (entity: T) => string): T[] {
  const values = new Map<string, T>()
  for (const entity of entities) {
    const id = key(entity)
    const previous = values.get(id)
    if (!previous || previous.history.length < entity.history.length) values.set(id, entity)
  }
  return [...values.values()]
}

export function pageSnapshot(updates: EntityUpdate[], page: ForumState['page']): EntityUpdate {
  const initial = updates[0]
  const threads = latest(updates.flatMap((update) => update.threads ?? []), (entity) => numberKey(entity.key.board, Number(entity.key.number)))
    .filter((entity) => page.mode === 'thread'
      ? EntityId.thread(entity.key.board, Number(entity.key.number)) === page.threadId
      : page.mode === 'board' && EntityId.board(entity.key.board) === page.boardId)
  const thread = page.mode === 'thread' ? threads[0] : undefined
  const previews = new Set(threads.flatMap((entity) => [Number(entity.key.number), ...threadValue(entity).last_posts.map(Number)].map((number) => numberKey(entity.key.board, number))))
  const posts = latest(updates.flatMap((update) => update.posts ?? []), (entity) => numberKey(entity.key.board, Number(entity.key.number)))
    .filter((entity) => page.mode === 'thread'
      ? !!thread && entity.key.board === thread.key.board && postValue(entity).thread === thread.key.number
      : page.mode === 'board' && previews.has(numberKey(entity.key.board, Number(entity.key.number))))
  const myReactions = new Map<string, NonNullable<EntityUpdate['myReactions']>[number][1]>()
  for (const update of updates) {
    for (const [id, selection] of update.myReactions ?? []) {
      const previous = myReactions.get(id)
      if (!previous || previous.seq < selection.seq) myReactions.set(id, selection)
    }
  }
  const postIds = new Set(posts.map((post) => EntityId.post(post.key.board, Number(post.key.number))))
  const snapshot: EntityUpdate = {
    ...initial,
    forums: latest(updates.flatMap((update) => update.forums ?? []), () => EntityId.forum()),
    boards: latest(updates.flatMap((update) => update.boards ?? []), (entity) => entity.key.slug),
    threads,
    posts,
    myReactions: [...myReactions].filter(([id]) => postIds.has(id)),
    contents: new Map(updates.flatMap((update) => [...update.contents ?? []])),
    attachments: new Map(updates.flatMap((update) => [...update.attachments ?? []])),
    feed: initial.feed ? { ...initial.feed, threadIds: threads.map((entity) => EntityId.thread(entity.key.board, Number(entity.key.number))) } : undefined,
    retention: 'loaded',
  }
  const { contentHashes, attachmentHashes } = requiredResources(snapshot)
  snapshot.contents = [...snapshot.contents ?? []].filter(([hash]) => contentHashes.has(hash))
  snapshot.attachments = [...snapshot.attachments ?? []].filter(([hash]) => attachmentHashes.has(hash))
  return snapshot
}
