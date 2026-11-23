import type { ForumState } from '../model/state/forum'
import type { BoardCursor } from '../model/entities/board'
import type { BanScope } from '../model/rules/permissions'
import type { Commit } from './commit'
import { postValue, threadValue, userValue } from './convert/versions'
import { ForumApi } from './io/ech/forumApi'
import type { BanMapValue, BoardEntity, ForumEntity, PostEntity, PostPageEntity, ThreadEntity, ThreadPreviewEntity, Tx } from './io/ech/protocol/entities'
import { EntityId } from './io/ech/protocol/entityId'
import type { Media, Resources } from './io/ech/protocol/transactions'
import * as relay from './io/ech/relay'
import { relayEndpoint } from './io/ech/resolve'

export const clean = (s: string) => s.replace(/^0x/, '')

export interface ForumViewData {
  relayUrl: string
  forumId: string
  forum: ForumEntity
  boards: BoardEntity[]
  contentMap: Map<string, Uint8Array>
  mediaMeta: Map<string, Media>
  transactions: Map<string, Tx>
}

export interface PostCtx extends ForumViewData {
  board: BoardEntity
  myReactions: PostPageEntity['my_reactions']
  bans: Map<BanScope, Uint8Array[]>
}

export interface ThreadViewData extends PostCtx {
  threadId: string
  thread: ThreadEntity
  posts: PostEntity[]
}

export interface BoardViewData extends PostCtx {
  boardId: string
  threads: ThreadPreviewEntity[]
  next: BoardCursor | null
}

export interface PostViewData extends PostCtx {
  threadId: string
  thread: ThreadEntity
  post: PostEntity
  op: PostEntity | null
}

export interface UserViewData {
  sid: string
  genesis: string
  history: number
  postCount: number
  threadCount: number
  lastPost: number
  lastReaction: number
}

function toBans(values: BanMapValue): Map<BanScope, Uint8Array[]> {
  const bans = new Map<BanScope, Uint8Array[]>()
  for (const [scope, targets] of values) {
    const key: BanScope = scope.$kind === 'Thread' ? 'thread' : scope.$kind === 'Board' ? 'board' : 'forum'
    bans.set(key, targets)
  }
  return bans
}

function mergeBans(pages: Map<BanScope, Uint8Array[]>[]): Map<BanScope, Uint8Array[]> {
  const merged = new Map<BanScope, Uint8Array[]>()
  for (const page of pages) {
    for (const [scope, targets] of page) {
      const known = merged.get(scope)
      if (known) known.push(...targets)
      else merged.set(scope, [...targets])
    }
  }
  return merged
}

function resources(pages: Resources<unknown>[]) {
  return {
    contentMap: new Map(pages.flatMap((page) => [...page.contents].flatMap(([hash, bytes]) => bytes ? [['0x' + clean(hash), bytes] as const] : []))),
    mediaMeta: new Map(pages.flatMap((page) => [...page.attachments].flatMap(([hash, media]) => media ? [['0x' + clean(hash), media] as const] : []))),
    transactions: new Map(pages.flatMap((page) => [...page.transactions])),
  }
}

export function createForumGateway(model: ForumState, commit: Commit) {
  const pending = new Map<string, Promise<ForumApi>>()

  async function connect(base: string): Promise<ForumApi> {
    const endpoint = await relayEndpoint(base)
    const key = endpoint.replace(/\/$/, '').replace(/\/api$/, '')
    const known = model.relays[key]
    if (known) return new ForumApi(known, model.session)
    const running = pending.get(key)
    if (running) return running
    const request = relay.connect(`${key}/api`).then((value) => {
      commit({ type: 'relay.set', value: { key, value } })
      return new ForumApi(model.relays[key] ?? value, model.session)
    }).finally(() => pending.delete(key))
    pending.set(key, request)
    return request
  }

  async function metadata(relayUrl: string, board?: string, thread?: number) {
    const api = await connect(relayUrl)
    const data = await api.metadata(board, thread)
    return {
      api,
      data,
      context: {
        relayUrl: api.relay.base.replace(/\/api$/, ''),
        forumId: relay.hex(api.root),
        forum: data.forum.view,
        boards: data.boards.view.boards,
        ...resources([data.forum, data.boards, ...(data.board ? [data.board] : []), ...(data.thread ? [data.thread] : [])]),
      },
    }
  }

  async function readThread(relayUrl: string, board: string, number: number): Promise<ThreadViewData> {
    const { api, data, context } = await metadata(relayUrl, board, number)
    const thread = data.thread!.view.thread
    const pageSize = Number(data.thread!.view.page_size)
    if (!Number.isSafeInteger(pageSize) || pageSize <= 0) throw new Error('Invalid thread page size')
    const count = Number(threadValue(thread).post_count)
    const cursors: number[] = []
    for (let after = 0; after < count; after += pageSize) cursors.push(after)
    const pages = await api.threadPages(board, number, cursors)
    const content = resources(pages)
    const posts = pages.flatMap((page) => [...page.view.posts.values()])
    return {
      ...context,
      board: data.board!.view,
      threadId: EntityId.thread(board, number),
      thread,
      myReactions: new Map(pages.flatMap((page) => [...page.view.my_reactions])),
      bans: mergeBans(pages.map((page) => toBans(page.view.bans))),
      posts,
      contentMap: new Map([...context.contentMap, ...content.contentMap]),
      mediaMeta: new Map([...context.mediaMeta, ...content.mediaMeta]),
      transactions: new Map([...context.transactions, ...content.transactions]),
    }
  }

  async function readBoard(relayUrl: string, slug: string, cursor: BoardCursor | null = null): Promise<BoardViewData> {
    const { api, data, context } = await metadata(relayUrl, slug)
    const response = await api.board(slug, cursor)
    const content = resources([response])
    return {
      ...context,
      board: data.board!.view,
      boardId: EntityId.board(slug),
      threads: response.view.threads,
      myReactions: response.view.my_reactions,
      bans: toBans(response.view.bans),
      next: response.view.next,
      contentMap: new Map([...context.contentMap, ...content.contentMap]),
      mediaMeta: new Map([...context.mediaMeta, ...content.mediaMeta]),
      transactions: new Map([...context.transactions, ...content.transactions]),
    }
  }

  async function readForum(relayUrl: string): Promise<ForumViewData> {
    return (await metadata(relayUrl)).context
  }

  async function readPost(relayUrl: string, postId: string): Promise<PostViewData> {
    const api = await connect(relayUrl)
    const postPage = await api.post(postId)
    const post = postPage.view.post
    const board = post.key.board
    const thread = Number(postValue(post).thread)
    const { data, context } = await metadata(relayUrl, board, thread)
    const opPage = Number(post.key.number) === thread ? postPage : await api.post(EntityId.post(board, thread))
    const content = resources([postPage, opPage])
    return {
      ...context,
      board: data.board!.view,
      threadId: EntityId.thread(board, thread),
      thread: data.thread!.view.thread,
      post,
      op: opPage.view.post,
      myReactions: new Map([...postPage.view.my_reactions, ...opPage.view.my_reactions]),
      bans: mergeBans([toBans(postPage.view.bans), toBans(opPage.view.bans)]),
      contentMap: new Map([...context.contentMap, ...content.contentMap]),
      mediaMeta: new Map([...context.mediaMeta, ...content.mediaMeta]),
      transactions: new Map([...context.transactions, ...content.transactions]),
    }
  }

  async function readUser(relayUrl: string): Promise<UserViewData | null> {
    const api = await connect(relayUrl)
    const entity = await api.user()
    if (!entity) return null
    const value = userValue(entity)
    return {
      sid: relay.hex(entity.key),
      genesis: relay.hex(entity.genesis),
      history: Number(entity.history.length),
      postCount: Number(value.post_count),
      threadCount: Number(value.thread_count),
      lastPost: Number(value.last_post),
      lastReaction: Number(value.last_reaction),
    }
  }

  return { connect, readThread, readBoard, readForum, readPost, readUser }
}

export type ForumGateway = ReturnType<typeof createForumGateway>
