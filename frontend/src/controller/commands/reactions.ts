import { bcs } from '@mysten/bcs'
import { fromHex, toHex } from '../../model/content/hex'
import { resourceKey } from '../../model/state/resources'
import type { Commit } from '../commit'
import { readClipboard, writeClipboard } from '../io/browser/clipboard'
import { stageReaction } from '../io/browser/reactions'

const ReactionVec = bcs.vector(bcs.bytes(32))

export function createReactionCommands(commit: Commit) {
  return {
    async stageReaction(relayUrl: string, file: File) {
      const { hash, preview, bytes } = await stageReaction(file)
      commit({ type: 'reactionUpload.set', value: { key: resourceKey(relayUrl, hash.replace(/^0x/, '')), value: { preview, bytes } } })
      return hash
    },
    async copyReactions(reactions: Uint8Array[]) {
      if (reactions.length) await writeClipboard(toHex(ReactionVec.serialize(reactions).toBytes()))
    },
    async pasteReactions(): Promise<Uint8Array[]> {
      const text = (await readClipboard()).trim()
      if (!text) return []
      try { return ReactionVec.parse(fromHex(text)) } catch { return [] }
    },
  }
}
