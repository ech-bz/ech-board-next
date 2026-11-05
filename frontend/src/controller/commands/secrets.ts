import { fromHex } from '../../model/content/hex'
import { secretKey, type SecretContent } from '../../model/content/secrets'
import { forumKey } from '../../model/selectors/forum'
import { ownIdentities } from '../../model/selectors/identities'
import type { ForumState } from '../../model/state/forum'
import type { Commit } from '../commit'
import { esidFromHex } from '../io/crypto/esid'
import { Identity } from '../io/crypto/identity'
import { tryDecryptSecret } from '../io/crypto/secret'
import { PostPartVec } from '../io/ech/protocol/types'

export function createSecretCommands(model: ForumState, commit: Commit) {
  let disposed = false
  return {
    async revealSecret(forumId: string, author: string, secret: SecretContent) {
      const revision = model.page.revision
      const key = secretKey(forumId, author, secret)
      const previous = model.resources.secrets[key]
      if (previous?.parts || previous?.loading) return
      commit({ type: 'secret.set', value: { key, value: { parts: null, loading: true, error: false } } })
      try {
        const scope = model.scopes[forumKey(forumId)]
        if (!scope) throw new Error('Forum is unavailable')
        const root = fromHex(scope.root)
        const identity = Identity.fromHex(model.session.master)
        for (const own of ownIdentities(scope)) {
          const bytes = await tryDecryptSecret(secret.data_nonce, secret.data_ct, secret.encrypted_keys, identity.secret(root, own.tweak), esidFromHex(author).c1)
          if (disposed || revision !== model.page.revision) return
          if (bytes !== null) {
            commit({ type: 'secret.set', value: { key, value: { parts: PostPartVec.parse(bytes), loading: false, error: false } } })
            return
          }
        }
      } catch { }
      if (!disposed && revision === model.page.revision) commit({ type: 'secret.set', value: { key, value: { parts: null, loading: false, error: true } } })
    },
    disposeSecrets() { disposed = true },
  }
}
