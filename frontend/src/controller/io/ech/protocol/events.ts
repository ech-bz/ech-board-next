export interface EntityPayload {
  kind: string
  id: string
  value: string
}

export interface RealtimeEvent {
  txid: string
  function: string
  board: string
  thread: string
  entities: EntityPayload[]
  contents: BlobPayload[]
  attachments: BlobPayload[]
}

export interface BlobPayload {
  hash: string
  value: string
}

