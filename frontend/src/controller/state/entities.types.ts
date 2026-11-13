import type { Media } from '../../model/entities/media'
import type { BoardCursor } from '../../model/entities/board'
import type { PostPreview, ReactionSelection } from '../../model/state/forum'
import type { PostRetention } from '../../model/state/retention'
import type { BoardEntity, ForumEntity, PostEntity, ThreadEntity, Tx } from '../io/ech/protocol/entities'

export interface EntityUpdate {
  txid?: string
  transactions?: ReadonlyMap<string, Tx>
  myReactions?: ReadonlyArray<readonly [string, ReactionSelection]>
  scope: { forumId: string; relayUrl: string }
  posts?: readonly PostEntity[]
  threads?: readonly ThreadEntity[]
  boards?: readonly BoardEntity[]
  forums?: readonly ForumEntity[]
  contents?: Iterable<readonly [string, Uint8Array]>
  attachments?: Iterable<readonly [string, Media]>
  feed?: { boardId: string; threadIds: string[]; next: BoardCursor | null; append?: boolean }
  loadedThread?: string
  preview?: PostPreview
  retention?: PostRetention
}
