import { blake2b } from '@noble/hashes/blake2'
import { toHex } from '../../model/content/hex'
import { validBoardSlug } from '../../model/rules/board'
import { roleForForumSettings } from '../../model/rules/permissions'
import { roleTweak } from '../../model/rules/roles'
import { forumKey } from '../../model/selectors/forum'
import type { ForumState } from '../../model/state/forum'
import type { Commit } from '../commit'
import type { ForumGateway } from '../forumGateway'
import { forumChanges } from '../ingestion/pages'
import type { Receive } from '../ingestion/receive'
import { Calls } from '../io/ech/forumApi'

export function createForumCommands(model: ForumState, commit: Commit, gateway: ForumGateway, receive: Receive, onError: (error: unknown) => void) {
  const moderator = (forumId: string) => {
    const scope = model.scopes[forumKey(forumId)]
    const forum = scope ? Object.values(scope.entities.forums)[0] : null
    return forum ? roleForForumSettings(forum.roles) : null
  }

  return {
    openForumTitle(forumId: string) {
      if (moderator(forumId)) commit({ type: 'dialogs.patch', value: { forumTitle: { forumId } } })
    },
    async setForumTitle(forumId: string, title: string) {
      if (model.operations.moderating || !title.trim()) return
      const scope = model.scopes[forumKey(forumId)]
      const role = moderator(forumId)
      if (!scope || !role) return
      commit({ type: 'operations.patch', value: { moderating: true } })
      try {
        const bytes = new TextEncoder().encode(title.trim())
        const hash = toHex(blake2b(bytes, { dkLen: 32 }))
        const api = await gateway.connect(scope.relayUrl)
        await api.append(Calls.forum.set_title(hash), [{ hash, bytes }], roleTweak(role))
        const data = await gateway.readForum(scope.relayUrl)
        receive(forumChanges(data), { type: 'dialogs.patch', value: { forumTitle: null } })
      } catch (error) {
        onError(error)
      } finally {
        commit({ type: 'operations.patch', value: { moderating: false } })
      }
    },
    openCreateBoard(forumId: string) {
      if (moderator(forumId)) commit({ type: 'dialogs.patch', value: { createBoard: { forumId } } })
    },
    async createBoard(forumId: string, slug: string, description: string) {
      if (model.operations.moderating) return
      const scope = model.scopes[forumKey(forumId)]
      const role = moderator(forumId)
      if (!scope || !role) return
      if (!validBoardSlug(slug)) { onError(new Error('InvalidBoardSlug')); return }
      commit({ type: 'operations.patch', value: { moderating: true } })
      try {
        const bytes = new TextEncoder().encode(description.trim())
        const hash = bytes.length ? toHex(blake2b(bytes, { dkLen: 32 })) : null
        const api = await gateway.connect(scope.relayUrl)
        await api.append(Calls.board.create(slug, hash), hash ? [{ hash, bytes }] : [], roleTweak(role))
        const data = await gateway.readForum(scope.relayUrl)
        receive(forumChanges(data), { type: 'dialogs.patch', value: { createBoard: null } })
      } catch (error) {
        onError(error)
      } finally {
        commit({ type: 'operations.patch', value: { moderating: false } })
      }
    },
  }
}
