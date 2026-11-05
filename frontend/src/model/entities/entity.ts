export interface Entity {
  readonly id: string
  readonly sequence: bigint
}

export interface Counter {
  readonly hash: Uint8Array
  readonly count: bigint
}

export type EntityKind = 'post' | 'thread' | 'board' | 'forum'

export interface EntityObject {
  kind: EntityKind
  id: string
}

