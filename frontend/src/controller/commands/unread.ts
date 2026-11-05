import { onCleanup, untrack } from 'solid-js'
import { observeUnread } from '../../model/rules/unread'
import type { ForumState } from '../../model/state/forum'
import { emptyUnread, type UnreadObservation } from '../../model/state/unread'
import type { Commit } from '../commit'

export function createUnreadCommands(model: ForumState, commit: Commit) {
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  const cancelTimer = () => {
    if (hideTimer !== null) clearTimeout(hideTimer)
    hideTimer = null
  }
  onCleanup(cancelTimer)
  return {
    beginUnread(reloadSequence: number) {
      cancelTimer()
      commit({ type: 'unread.set', value: emptyUnread(reloadSequence) })
    },
    observeUnread(observation: UnreadObservation, source: 'posts' | 'viewport') {
      untrack(() => {
        const result = observeUnread(model.unread, observation, source)
        commit({ type: 'unread.set', value: result.state })
        if (result.marker === 'cancel') cancelTimer()
        if (result.marker === 'hide' && hideTimer === null) {
          hideTimer = setTimeout(() => {
            hideTimer = null
            commit({ type: 'unread.set', value: { ...model.unread, markerIndex: null } })
          }, 2000)
        }
      })
    },
    endUnread() {
      cancelTimer()
      commit({ type: 'unread.set', value: emptyUnread() })
    },
  }
}
