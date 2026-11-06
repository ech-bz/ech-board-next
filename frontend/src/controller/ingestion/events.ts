import { fromHex, toHex } from '../../model/content/hex'
import type { Media } from '../../model/entities/media'
import { forumKey } from '../../model/selectors/forum'
import type { ForumState } from '../../model/state/forum'
import { requiredResources } from '../convert/resources'
import { postValue } from '../convert/versions'
import type { ForumGateway } from '../forumGateway'
import { parseEntity, type BoardEntity, type ForumEntity, type PostEntity, type ThreadEntity } from '../io/ech/protocol/entities'
import { EntityId } from '../io/ech/protocol/entityId'
import type { RealtimeEvent } from '../io/ech/protocol/events'
import { EsidSchema, MediaMetaSchema } from '../io/ech/protocol/transactions'
import type { EntityUpdate } from '../state/entities.types'


export async function eventChanges(model: ForumState, gateway: ForumGateway, relayUrl: string, event: RealtimeEvent, fresh = false): Promise<EntityUpdate> {
  const api = await gateway.connect(relayUrl)
  const root = toHex(api.root)
  const scope = fresh ? undefined : model.scopes[forumKey(root)]
  const contents = new Map<string, Uint8Array>()
  for (const item of event.contents) {
    const hash = toHex(fromHex(item.hash))
    if (!scope?.contents[hash]) contents.set(hash, fromHex(item.value))
  }
  const attachments = new Map<string, Media>(event.attachments.map((item) => [toHex(fromHex(item.hash)), MediaMetaSchema.parse(fromHex(item.value))]))
  const posts: PostEntity[] = []
  const threads: ThreadEntity[] = []
  const boards: BoardEntity[] = []
  const forums: ForumEntity[] = []
  const changes: EntityUpdate = { txid: event.txid, scope: { forumId: root, relayUrl }, posts, threads, boards, forums }
  for (const entity of event.entities) {
    const bytes = fromHex(entity.value)
    if (entity.kind === 'post') posts.push(parseEntity('post', bytes))
    if (entity.kind === 'thread') threads.push(parseEntity('thread', bytes))
    if (entity.kind === 'board') boards.push(parseEntity('board', bytes))
    if (entity.kind === 'forum') forums.push(parseEntity('forum', bytes))
  }
  if (!fresh) {
    changes.threads = threads.filter((entity) => model.page.mode === 'thread'
      ? EntityId.thread(entity.key.board, Number(entity.key.number)) === model.page.threadId
      : model.page.mode === 'board' && EntityId.board(entity.key.board) === model.page.boardId)
    changes.posts = posts.filter((entity) => model.page.mode === 'thread'
      ? EntityId.thread(entity.key.board, Number(postValue(entity).thread)) === model.page.threadId
      : model.page.mode === 'board' && EntityId.board(entity.key.board) === model.page.boardId)
  }
  if (event.reaction) {
    const author = EsidSchema.parse(fromHex(event.reaction.author))
    const id = toHex(fromHex(event.reaction.post))
    const post = changes.posts?.find((post) => EntityId.post(post.key.board, Number(post.key.number)) === id)
    if (post && api.identity.owns(api.root, author)) {
      changes.myReactions = [[id, { seq: post.seq, value: event.reaction.value === null ? null : toHex(fromHex(event.reaction.value)) }]]
    }
  }
  const { contentHashes, attachmentHashes } = requiredResources(changes)
  for (const hash of contents.keys()) if (!contentHashes.has(hash)) contents.delete(hash)
  for (const hash of attachments.keys()) if (!attachmentHashes.has(hash)) attachments.delete(hash)
  await Promise.allSettled([
    ...[...contentHashes].filter((hash) => !contents.has(hash) && !scope?.contents[hash]).map(async (hash) => {
      const bytes = await api.loadContent(hash)
      if (bytes) contents.set(hash, bytes)
    }),
    ...[...attachmentHashes].filter((hash) => !attachments.has(hash) && !scope?.attachments[hash]).map(async (hash) => {
      const media = await api.loadAttachment(hash)
      if (media) attachments.set(hash, media)
    }),
  ])
  changes.contents = contents
  changes.attachments = attachments
  changes.retention = 'realtime'
  return changes
}
