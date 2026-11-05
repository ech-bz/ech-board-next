import type { UnreadObservation, UnreadState } from '../state/unread'

export function observeUnread(previous: UnreadState, observation: UnreadObservation, source: 'posts' | 'viewport'): { state: UnreadState; marker: 'hide' | 'keep' | 'cancel' } {
  const { total, reloadSequence, visible, atBottom } = observation
  if (source === 'posts' && total === 0) return { state: previous, marker: 'keep' }
  const state = { ...previous, total, reloadSequence }
  if (source === 'posts' && previous.total === 0) {
    return { state: { ...state, readCount: total, markerIndex: null, atBottom }, marker: 'keep' }
  }
  if (source === 'posts' && reloadSequence === previous.reloadSequence && previous.atBottom && visible) {
    return { state: { ...state, readCount: total, atBottom }, marker: 'keep' }
  }
  if (visible) {
    state.atBottom = atBottom
    if (atBottom) return { state: { ...state, readCount: total }, marker: 'hide' }
  }
  if (source === 'posts' && state.readCount < total) {
    return { state: { ...state, markerIndex: state.readCount }, marker: 'cancel' }
  }
  return { state, marker: 'keep' }
}
