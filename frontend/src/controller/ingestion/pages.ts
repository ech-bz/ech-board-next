import { toHex } from '../../model/content/hex'
import { emptyDialogs } from '../../model/state/dialogs'
import type { ForumState } from '../../model/state/forum'
import type { Operation } from '../commit'
import type { BoardViewData, ForumViewData, PostViewData, ThreadViewData } from '../forumGateway'
import type { PostEntity, PostPageEntity } from '../io/ech/protocol/entities'
import { EntityId } from '../io/ech/protocol/entityId'
import type { EntityUpdate } from '../state/entities.types'

function resources(data: ForumViewData): EntityUpdate {
  return {
    scope: { forumId: data.forumId, relayUrl: data.relayUrl },
    forums: [data.forum],
    boards: data.boards,
    contents: data.contentMap,
    attachments: data.mediaMeta,
  }
}

export function forumChanges(data: ForumViewData): EntityUpdate {
  return resources(data)
}

function myReactions(posts: readonly PostEntity[], values: PostPageEntity['my_reactions']): EntityUpdate['myReactions'] {
  const reactions = new Map([...values].map(([post, reaction]) => [toHex(post), toHex(reaction)]))
  return posts.map((post) => {
    const id = EntityId.post(post.key.board, Number(post.key.number))
    return [id, { seq: post.seq, value: reactions.get(id) ?? null }]
  })
}

export function threadChanges(data: ThreadViewData): EntityUpdate {
  return { ...resources(data), myReactions: myReactions(data.posts, data.myReactions), boards: [...data.boards, data.board], threads: [data.thread], posts: data.posts, retention: 'loaded', loadedThread: data.threadId }
}

export function boardChanges(data: BoardViewData, append = false): EntityUpdate {
  const posts = data.threads.flatMap((page) => [...page.posts.values()])
  return {
    ...resources(data),
    myReactions: myReactions(posts, data.myReactions),
    boards: [...data.boards, data.board],
    threads: data.threads.map((page) => page.thread),
    posts,
    retention: 'loaded',
    feed: { boardId: EntityId.board(data.board.key.slug), threadIds: data.threads.map((page) => EntityId.thread(page.thread.key.board, Number(page.thread.key.number))), next: data.next, append },
  }
}

export function postChanges(data: PostViewData): EntityUpdate {
  const posts = data.op && data.op.key.number !== data.post.key.number ? [data.post, data.op] : [data.post]
  return { ...resources(data), myReactions: myReactions(posts, data.myReactions), boards: [...data.boards, data.board], threads: [data.thread], posts }
}

export function pageReplacement(model: ForumState, page: ForumState['page']): Operation[] {
  return [
    { type: 'preview.release', value: Object.keys(model.previews).map(Number) },
    { type: 'gallery.set', value: null },
    { type: 'selection.set', value: { ids: [], lastId: null } },
    { type: 'dialogs.patch', value: emptyDialogs() },
    { type: 'resources.releasePage', value: null },
    { type: 'entities.reset', value: null },
    { type: 'page.patch', value: page },
  ]
}
