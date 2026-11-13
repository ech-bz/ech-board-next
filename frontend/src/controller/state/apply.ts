import { produce, reconcile, type SetStoreFunction } from 'solid-js/store'
import { forumKey } from '../../model/selectors/forum'
import type { ForumState } from '../../model/state/forum'
import type { Operation } from './operations'
import { expirePermissions, refreshPermissions } from './permissions'

export type LocalOperation = Exclude<Operation, { type: 'entities.ingest' | 'entities.reset' }>

export function applyLocalOperation(model: ForumState, write: SetStoreFunction<ForumState>, operation: LocalOperation) {
  switch (operation.type) {
    case 'resources.releasePage':
      for (const key of ['bans', 'history', 'snapshots', 'secrets'] as const) write('resources', key, reconcile({}))
      break
    case 'realtime.set': write('realtime', reconcile(operation.value)); break
    case 'realtime.enqueue': write('realtime', 'events', model.realtime.events.length, operation.value); break
    case 'dialogs.patch': write('dialogs', operation.value); break
    case 'selection.set': write('selection', reconcile(operation.value)); break
    case 'gallery.set': write('gallery', reconcile(operation.value)); break
    case 'unread.set': write('unread', reconcile(operation.value)); break
    case 'session.set': write('session', reconcile(operation.value)); break
    case 'preferences.patch': write('preferences', operation.value); break
    case 'operations.patch': write('operations', operation.value); break
    case 'navigation.patch': write('navigation', operation.value); break
    case 'relay.set': write('relays', operation.value.key, reconcile(operation.value.value)); break
    case 'draft.patch': {
      const { mode, value } = operation.value
      write('drafts', mode, { ...value, revision: model.drafts[mode].revision + 1 })
      break
    }
    case 'reaction.setBusy': {
      const { key, busy } = operation.value
      if (busy) write('operations', 'reacting', key, true)
      else write('operations', 'reacting', produce((values) => { delete values[key] }))
      break
    }
    case 'bans.set': write('resources', 'bans', operation.value.key, reconcile(operation.value.value)); break
    case 'history.set': write('resources', 'history', operation.value.key, reconcile(operation.value.value)); break
    case 'snapshot.set': write('resources', 'snapshots', operation.value.key, reconcile(operation.value.value)); break
    case 'secret.set': write('resources', 'secrets', operation.value.key, reconcile(operation.value.value)); break
    case 'reactionUpload.set': write('resources', 'reactions', operation.value.key, reconcile(operation.value.value)); break
    case 'reactionUpload.release':
      for (const key of operation.value) if (model.resources.reactions[key]) write('resources', 'reactions', key, 'bytes', null)
      break
    case 'notification.add': write('notifications', (items) => [...items, operation.value]); break
    case 'notification.remove': write('notifications', (items) => items.filter((item) => item.id !== operation.value)); break
    case 'page.patch': {
      const value = operation.value
      write('page', { ...value, ...(value.forumId ? { forumId: forumKey(value.forumId) } : {}) })
      break
    }
    case 'preview.set': write('previews', operation.value.id, reconcile(operation.value)); break
    case 'preview.close':
      for (const id of operation.value) if (model.previews[id]) write('previews', id, 'active', false)
      break
    case 'preview.release':
      write('previews', produce((previews) => { for (const id of operation.value) delete previews[id] }))
      break
    case 'permissions.expire': expirePermissions(model, write, operation.value); break
    case 'permissions.refresh': refreshPermissions(model, write, operation.value); break
    case 'authors.merge': {
      const { root, values } = operation.value
      const added = Object.keys(values).filter((key) => values[key].mine && !model.scopes[root].authors[key]?.mine)
      write('scopes', root, 'authors', values)
      for (const id of added) write('scopes', root, 'ownedAuthorIds', model.scopes[root].ownedAuthorIds.length, id)
      break
    }
    case 'reactions.confirm': {
      const { root, values, txid } = operation.value
      const scope = model.scopes[root]
      for (const [id, selection] of values) {
        if (!scope.entities.posts[id]) continue
        const previous = scope.myReactions[id]
        const pending = scope.pendingReactions[id]
        const current = !previous || previous.seq <= selection.seq
        if (current) write('scopes', root, 'myReactions', id, reconcile(selection))
        if (pending && (pending.txid === txid || (current && pending.base !== selection.value))) {
          write('scopes', root, 'pendingReactions', produce((reactions) => { delete reactions[id] }))
        }
      }
      break
    }
    case 'reaction.setPending': {
      const { root, id, value } = operation.value
      if (value) write('scopes', root, 'pendingReactions', id, reconcile(value))
      else write('scopes', root, 'pendingReactions', produce((reactions) => { delete reactions[id] }))
      break
    }
    default: {
      const exhaustive: never = operation
      return exhaustive
    }
  }
}
