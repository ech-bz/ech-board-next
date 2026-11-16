export interface EntityPayload {
  kind: string
  id: string
  value: string
}

export interface BlobPayload {
  hash: string
  value: string
}

export interface EventPayload {
  entities: EntityPayload[]
  contents: BlobPayload[]
  attachments: BlobPayload[]
  transactions: BlobPayload[]
}

export interface RealtimeEvent {
  txid: string
  function: string
  reaction: { author: string; post: string; value: string | null } | null
  board: string
  thread: string
  payload: EventPayload
}

