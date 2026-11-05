export interface SessionState {
  master: string
}

export interface RelayDescriptor {
  base: string
  root: Uint8Array
  program: Uint8Array
}
