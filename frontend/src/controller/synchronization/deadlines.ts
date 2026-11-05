import { createEffect, onCleanup } from 'solid-js'
import { nextPermissionDeadline } from '../../model/selectors/roles'
import type { ForumState } from '../../model/state/forum'
import type { Commit } from '../commit'

export function synchronizeDeadlines(model: ForumState, commit: Commit): void {
  createEffect(() => {
    const deadline = nextPermissionDeadline(model)
    if (deadline === null) return
    const timer = setTimeout(() => commit({ type: 'permissions.expire', value: Date.now() }), Math.max(0, deadline - Date.now()))
    onCleanup(() => clearTimeout(timer))
  })
}
