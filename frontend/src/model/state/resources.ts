import type { PostPart } from '../content/postPart'
import type { BanListState, HistoryState, SnapshotState } from './inspection'

export interface SecretState {
  parts: PostPart[] | null
  loading: boolean
  error: boolean
}

export interface ResourceState {
  bans: Record<string, BanListState>
  history: Record<string, HistoryState>
  snapshots: Record<string, SnapshotState>
  secrets: Record<string, SecretState>
  reactions: Record<string, { preview: string; bytes: Uint8Array | null }>
}

export const resourceKey = (...parts: string[]): string => JSON.stringify(parts)
