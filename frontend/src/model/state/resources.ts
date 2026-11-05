import type { PostPart } from '../content/postPart'
import type { BanListState, FeedState, SnapshotState } from './inspection'

export interface SecretState {
  parts: PostPart[] | null
  loading: boolean
  error: boolean
}

export interface ResourceState {
  bans: Record<string, BanListState>
  feeds: Record<string, FeedState>
  snapshots: Record<string, SnapshotState>
  secrets: Record<string, SecretState>
  reactions: Record<string, { preview: string; bytes: Uint8Array | null }>
}

export const resourceKey = (...parts: string[]): string => JSON.stringify(parts)
