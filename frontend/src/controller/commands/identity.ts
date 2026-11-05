import type { ForumState } from '../../model/state/forum'
import type { Commit } from '../commit'
import { writeClipboard } from '../io/browser/clipboard'
import { saveSession } from '../io/browser/session'
import { Identity, randomTweak } from '../io/crypto/identity'
import { fromHex } from '@mysten/bcs'
import { forumKey } from '../../model/selectors/forum'
import { esidHex } from '../io/crypto/esid'

export function createIdentityCommands(model: ForumState, commit: Commit) {
  return {
    importMasterKey(value: string) {
      const master = Identity.fromHex(value).hex()
      const previous = { ...model.session }
      commit({ type: 'session.set', value: { ...previous, master } })
      try { saveSession(model.session) }
      catch (error) { commit({ type: 'session.set', value: previous }); throw error }
      window.location.reload()
    },
    copyMasterKey() { return writeClipboard(model.session.master) },
    copyForumEsid(forumId: string) {
      const identity = Identity.fromHex(model.session.master)
      return writeClipboard(esidHex(identity.esid(fromHex(forumKey(forumId)), randomTweak())))
    },
  }
}
