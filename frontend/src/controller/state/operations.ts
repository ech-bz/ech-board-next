import type { ForumState, PendingReaction, PostPreview, ReactionSelection } from '../../model/state/forum'
import type { BanListState, FeedState, SnapshotState } from '../../model/state/inspection'
import type { SecretState } from '../../model/state/resources'
import type { EntityUpdate } from './entities.types'

interface OperationValues {
  'entities.reset': null
  'resources.releasePage': null
  'realtime.set': ForumState['realtime']
  'realtime.enqueue': string
  'dialogs.patch': Partial<ForumState['dialogs']>
  'selection.set': ForumState['selection']
  'reaction.setBusy': { key: string; busy: boolean }
  'gallery.set': ForumState['gallery']
  'unread.set': ForumState['unread']
  'session.set': ForumState['session']
  'relay.set': { key: string; value: ForumState['relays'][string] }
  'preferences.patch': Partial<ForumState['preferences']>
  'draft.patch': { mode: 'reply' | 'thread'; value: Partial<Omit<ForumState['drafts']['reply'], 'revision'>> }
  'operations.patch': Partial<ForumState['operations']>
  'bans.set': { key: string; value: BanListState }
  'feed.set': { key: string; value: FeedState }
  'snapshot.set': { key: string; value: SnapshotState }
  'secret.set': { key: string; value: SecretState }
  'reactionUpload.set': { key: string; value: ForumState['resources']['reactions'][string] }
  'reactionUpload.release': string[]
  'notification.add': { id: number; message: string }
  'notification.remove': number
  'page.patch': Partial<ForumState['page']>
  'preview.close': readonly number[]
  'preview.release': readonly number[]
  'permissions.expire': number
  'permissions.refresh': { root: string; posts: { board: string; number: number }[]; at: number }
  'navigation.patch': Partial<ForumState['navigation']>
  'entities.ingest': EntityUpdate
  'preview.set': PostPreview
  'authors.merge': { root: string; values: ForumState['scopes'][string]['authors'] }
  'reactions.confirm': { root: string; values: Iterable<readonly [string, ReactionSelection]>; txid?: string }
  'reaction.setPending': { root: string; id: string; value: PendingReaction | null }
}

export type Operation = { [K in keyof OperationValues]: { type: K; value: OperationValues[K] } }[keyof OperationValues]
export type Commit = (...operations: Operation[]) => void
