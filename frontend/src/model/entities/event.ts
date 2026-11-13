export interface HistoryEvent {
  readonly number: bigint | null
  readonly function: string
  readonly time: number
  readonly tx: unknown
}

