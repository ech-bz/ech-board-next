import type { Failure } from '../errors'
import type { Ban } from '../entities/ban'
import type { HistoryEvent } from '../entities/event'
import type { EntityKind } from '../entities/entity'

export type HistoryKind = EntityKind | 'author'

export interface BanListState {
  items: Ban[]
  loading: boolean
  error: Failure | null
}

export interface HistoryState {
  items: HistoryEvent[]
  next: string | null
  loading: boolean
  loadingMore: boolean
  error: Failure | null
}

export interface SnapshotState {
  data: { id: string; hex: string; entity: unknown } | null
  loading: boolean
  error: Failure | null
}

