export interface EntityPayload {
  kind: string
  id: string
  value: string
}

export interface RealtimeEvent {
  txid: string
  function: string
  reaction: { author: string; post: string; value: string | null } | null
  board: string
  thread: string
  entities: EntityPayload[]
  contents: BlobPayload[]
  attachments: BlobPayload[]
  transactions: BlobPayload[]
}

export interface BlobPayload {
  hash: string
  value: string
}

