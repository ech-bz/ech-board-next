import type { ForumState } from '../../model/state/forum'
import type { Commit } from '../commit'
import { failure } from '../errors'
import type { ForumGateway } from '../forumGateway'
import { eventChanges } from '../ingestion/events'
import { pageReplacement } from '../ingestion/pages'
import type { PrepareEntities, Receive } from '../ingestion/receive'
import { pageSnapshot } from '../ingestion/snapshot'
import type { RealtimeEvent } from '../io/ech/protocol/events'
import { RealtimeClient, type Subscription } from '../io/ech/realtime'
import type { EntityUpdate } from '../state/entities.types'

export function createRealtime(model: ForumState, commit: Commit, gateway: ForumGateway, receive: Receive, prepare: PrepareEntities, isDisposed: () => boolean, restore: () => void) {
  let events = Promise.resolve()
  const current = (revision: number) => !isDisposed() && revision === client.revision
  const receiveEvent = (relayUrl: string, event: RealtimeEvent) => {
    if (model.realtime.phase === 'loading') {
      commit({ type: 'realtime.enqueue', value: JSON.stringify(event) })
      return Promise.resolve()
    }
    const revision = client.revision
    const next = events.then(async () => {
      if (!current(revision) || model.realtime.phase !== 'live') return
      const changes = await eventChanges(model, gateway, relayUrl, event)
      if (current(revision) && model.realtime.phase === 'live') receive(changes)
    })
    events = next.catch((error) => {
      if (current(revision)) {
        commit({ type: 'navigation.patch', value: { error: failure(error) } })
        restore()
      }
    })
    return next
  }
  const client = new RealtimeClient({
    onEvent(event) {
      if (model.realtime.phase === 'loading') commit({ type: 'realtime.enqueue', value: event })
      else {
        const context = model.navigation.context
        if (context) {
          try { void receiveEvent(context.relayUrl, JSON.parse(event) as RealtimeEvent).catch(() => { }) }
          catch { restore() }
        }
      }
    },
    onDrop() {
      commit({ type: 'realtime.set', value: { phase: 'disconnected', events: [] } }, { type: 'navigation.patch', value: { reconnecting: true } })
    },
    onRestored() {
      if (!isDisposed()) restore()
    },
  })

  return {
    client,
    receiveEvent,
    async begin(relayUrl: string, subscription: Subscription) {
      events = Promise.resolve()
      commit({ type: 'realtime.set', value: { phase: 'loading', events: [] } })
      await client.begin(relayUrl, subscription)
      commit({ type: 'navigation.patch', value: { reconnecting: false } })
      return client.revision
    },
    async finish(revision: number, snapshot: EntityUpdate, page: ForumState['page']) {
      const updates = [snapshot]
      let position = 0
      while (current(revision) && model.realtime.phase === 'loading' && position < model.realtime.events.length) {
        const event = JSON.parse(model.realtime.events[position++]) as RealtimeEvent
        updates.push(await eventChanges(model, gateway, snapshot.scope.relayUrl, event, true))
      }
      if (!current(revision) || model.realtime.phase !== 'loading') return false
      const changes = pageSnapshot(updates, page)
      const operations = prepare(changes, true)
      commit(
        ...pageReplacement(model, page),
        ...operations,
        { type: 'realtime.set', value: { phase: 'live', events: [] } },
        { type: 'navigation.patch', value: { loading: false, refreshing: false, reconnecting: false, error: null } },
      )
      return true
    },
    close() {
      events = Promise.resolve()
      client.close()
      commit({ type: 'realtime.set', value: { phase: 'idle', events: [] } })
    },
  }
}

export type Realtime = ReturnType<typeof createRealtime>
