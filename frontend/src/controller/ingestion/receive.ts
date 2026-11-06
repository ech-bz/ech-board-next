import { fromHex } from '../../model/content/hex'
import { forumKey } from '../../model/selectors/forum'
import { type Commit } from '../commit'
import { entityAuthor } from '../convert/genesis'
import { boardValue, forumValue, threadValue } from '../convert/versions'
import { esidHex } from '../io/crypto/esid'
import { Identity } from '../io/crypto/identity'
import type { Esid } from '../io/ech/protocol/transactions'

import type { ForumState } from '../../model/state/forum'
import type { Operation } from '../commit'
import type { EntityUpdate } from '../state/entities.types'

export type Receive = (changes: EntityUpdate, ...operations: Operation[]) => void

export function createReceiver(model: ForumState, commit: Commit, isDisposed: () => boolean) {
  const prepare = (changes: EntityUpdate, fresh = false): Operation[] => {
    const root = forumKey(changes.scope.forumId)
    if (!root) return []
    const existing = fresh ? undefined : model.scopes[root]
    const identity = Identity.fromHex(model.session.master)
    const rootBytes = fromHex(root)
    const authors: ForumState['scopes'][string]['authors'] = {}
    const rememberOwner = (author: Esid) => {
      const key = esidHex(author)
      if (existing?.authors[key] !== undefined || authors[key] !== undefined) return
      authors[key] = { mine: identity.owns(rootBytes, author), tweak: author.tweak.slice() }
    }
    for (const entity of changes.posts ?? []) rememberOwner(entityAuthor(entity))
    for (const entity of changes.forums ?? []) for (const author of forumValue(entity).moderators) rememberOwner(author)
    for (const entity of changes.boards ?? []) for (const author of boardValue(entity).moderators) rememberOwner(author)
    for (const entity of changes.threads ?? []) {
      const thread = threadValue(entity)
      for (const author of thread.moderators) rememberOwner(author)
      if (thread.admin) rememberOwner(thread.admin)
    }
    return [
      { type: 'entities.ingest', value: changes },
      { type: 'authors.merge', value: { root, values: authors } },
      { type: 'permissions.refresh', value: { root, posts: (changes.posts ?? []).map((post) => ({ board: post.key.board, number: Number(post.key.number) })), at: Date.now() } },
      { type: 'reactions.confirm', value: { root, values: changes.myReactions ?? [], txid: changes.txid } },
    ]
  }
  const receive: Receive = (changes, ...operations) => {
    if (!isDisposed()) commit(...prepare(changes), ...operations)
  }

  return { receive, prepare }
}

export type PrepareEntities = ReturnType<typeof createReceiver>['prepare']
