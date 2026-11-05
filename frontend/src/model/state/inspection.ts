import type { Ban } from '../entities/ban'
import type { FeedEntry } from '../entities/event'

export interface BanListState {
  items: Ban[]
  loading: boolean
  error: string | null
}

export interface FeedState {
  items: FeedEntry[]
  next: string | null
  loading: boolean
  loadingMore: boolean
  error: string | null
}

export interface SnapshotState {
  data: { id: string; hex: string; entity: unknown } | null
  loading: boolean
  error: string | null
}

