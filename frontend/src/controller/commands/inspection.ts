import { untrack } from 'solid-js'
import { toHex } from '../../model/content/hex'
import { type EntityKind } from '../../model/entities/entity'
import { identityKey } from '../../model/rules/identity'
import type { ForumState } from '../../model/state/forum'
import { resourceKey } from '../../model/state/resources'
import type { Commit } from '../commit'
import { formatDebugValue } from '../convert/debug'
import type { ForumGateway } from '../forumGateway'
import { fetchBans, fetchEntitySnapshot, fetchHistory } from '../io/ech/admin'
import { convertHistory } from '../convert/history'

const message = (error: unknown) => error instanceof Error ? error.message : String(error)

export function createInspectionCommands(model: ForumState, commit: Commit, gateway: ForumGateway) {
  const requests = new Map<string, { id: number; page: number }>()
  let nextRequest = 0
  let disposed = false
  const begin = (key: string) => { const id = ++nextRequest; requests.set(key, { id, page: model.page.revision }); return id }
  const current = (key: string, id: number) => !disposed && requests.get(key)?.id === id && requests.get(key)?.page === model.page.revision
  const finish = (key: string, id: number) => { if (requests.get(key)?.id === id) requests.delete(key) }

  return {
    async loadBans(relayUrl: string, kind: EntityKind, id: string) {
      if (kind === 'post') return
      const key = resourceKey(relayUrl, kind, id)
      const request = begin(`bans:${key}`)
      commit({ type: 'bans.set', value: { key, value: { items: [], loading: true, error: null } } })
      try {
        const entries = await fetchBans(await gateway.connect(relayUrl), kind, id)
        if (!current(`bans:${key}`, request)) return
        const items = entries.map(([author, value]) => ({ author: identityKey(author), reason: value.reason_hash ? toHex(value.reason_hash) : null, expires: Number(value.expires) }))
        commit({ type: 'bans.set', value: { key, value: { items, loading: false, error: null } } })
      } catch (error) {
        if (current(`bans:${key}`, request)) commit({ type: 'bans.set', value: { key, value: { items: [], loading: false, error: message(error) } } })
      } finally {
        finish(`bans:${key}`, request)
      }
    },
    async loadSnapshot(relayUrl: string, kind: EntityKind, id: string) {
      const key = resourceKey(relayUrl, kind, id)
      const request = begin(`snapshot:${key}`)
      commit({ type: 'snapshot.set', value: { key, value: { data: null, loading: true, error: null } } })
      try {
        const snapshot = await fetchEntitySnapshot(relayUrl, kind, id)
        if (!current(`snapshot:${key}`, request)) return
        commit({ type: 'snapshot.set', value: { key, value: { data: { id: snapshot.id, hex: toHex(snapshot.bytes), entity: formatDebugValue(snapshot.entity) }, loading: false, error: null } } })
      } catch (error) {
        if (current(`snapshot:${key}`, request)) commit({ type: 'snapshot.set', value: { key, value: { data: null, loading: false, error: message(error) } } })
      } finally {
        finish(`snapshot:${key}`, request)
      }
    },
    async loadHistory(relayUrl: string, kind: EntityKind, id: string, more = false) {
      const key = resourceKey(relayUrl, kind, id)
      const previous = untrack(() => model.resources.history[key])
      if (more && (!previous?.next || previous.loading || previous.loadingMore)) return
      const request = begin(`history:${key}`)
      const items = more ? previous.items.slice() : []
      commit({ type: 'history.set', value: { key, value: { items, next: more ? previous.next : null, loading: !more, loadingMore: more, error: null } } })
      try {
        const page = await fetchHistory(relayUrl, kind, id, more ? previous.next : null)
        if (!current(`history:${key}`, request)) return
        commit({ type: 'history.set', value: { key, value: { items: [...items, ...page.entries.map(convertHistory)], next: page.next === null ? null : page.next.toString(), loading: false, loadingMore: false, error: null } } })
      } catch (error) {
        if (current(`history:${key}`, request)) commit({ type: 'history.set', value: { key, value: { items, next: more ? previous.next : null, loading: false, loadingMore: false, error: message(error) } } })
      } finally {
        finish(`history:${key}`, request)
      }
    },
    disposeInspection() { disposed = true; requests.clear() },
  }
}
