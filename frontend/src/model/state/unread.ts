export interface UnreadState {
  total: number
  readCount: number
  markerIndex: number | null
  atBottom: boolean
  reloadSequence: number
}

export interface UnreadObservation {
  total: number
  reloadSequence: number
  visible: boolean
  atBottom: boolean
}

export function emptyUnread(reloadSequence = 0): UnreadState {
  return { total: 0, readCount: 0, markerIndex: null, atBottom: false, reloadSequence }
}

export function unreadCount(state: UnreadState): number {
  return Math.max(0, state.total - state.readCount)
}
