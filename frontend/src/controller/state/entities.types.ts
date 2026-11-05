import type { Media } from '../../model/entities/media'
import type { PostPreview } from '../../model/state/forum'
import type { PostRetention } from '../../model/state/retention'
import type { BoardEntity, ForumEntity, PostEntity, ThreadEntity } from '../io/ech/protocol/entities'

export interface EntityUpdate {
  scope: { forumId: string; relayUrl: string }
  posts?: readonly PostEntity[]
  threads?: readonly ThreadEntity[]
  boards?: readonly BoardEntity[]
  forums?: readonly ForumEntity[]
  contents?: Iterable<readonly [string, Uint8Array]>
  attachments?: Iterable<readonly [string, Media]>
  feed?: { boardId: string; threadIds: string[]; next: number | null; append?: boolean }
  loadedThread?: string
  preview?: PostPreview
  retention?: PostRetention
}
