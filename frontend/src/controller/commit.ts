import { batch, untrack } from 'solid-js'
import { createStore } from 'solid-js/store'
import { heldForumRoots } from '../model/rules/scopes'
import { initialForumState } from '../model/state/forum'
import { applyLocalOperation } from './state/apply'
import { createEntityUpdates } from './state/entities'
import { createEntityLifecycle } from './state/lifecycle'
import type { Commit } from './state/operations'
import { createPostRetention } from './state/retention'

export type { Commit, Operation } from './state/operations'

export function createModel() {
  const [model, write] = createStore(initialForumState())
  const lifecycle = createEntityLifecycle()
  const retention = createPostRetention(model, write)
  const entities = createEntityUpdates(model, write, lifecycle, retention)
  const commit: Commit = (...operations) => untrack(() => batch(() => {
    let release = false
    let collectScopes = false
    for (const operation of operations) {
      if (operation.type === 'entities.ingest') entities.apply(operation.value)
      else if (operation.type === 'entities.reset') entities.reset()
      else applyLocalOperation(model, write, operation)
      if (['page.patch', 'navigation.patch', 'draft.patch', 'gallery.set', 'preview.release'].includes(operation.type)) collectScopes = true
      if (operation.type === 'preview.release' || operation.type === 'gallery.set' && operation.value === null) release = true
    }
    if (release) retention.release(entities.remove)
    if (collectScopes) {
      const held = heldForumRoots(model)
      for (const root of Object.keys(model.scopes)) if (!held.has(root)) entities.removeScope(root)
    }
  }))
  return { model, commit }
}
