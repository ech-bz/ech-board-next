import type { EntityKind, EntityObject } from '../../model/entities/entity'
import { forumKey } from '../../model/selectors/forum'
import type { DialogState } from '../../model/state/dialogs'
import { type Commit } from '../commit'


export function createOverlayCommands(commit: Commit) {
  return {
    openThreadTopic(threadId: string) { commit({ type: 'dialogs.patch', value: { topic: threadId } }) },
    openModerators(kind: 'forum' | 'board' | 'thread', threadId?: string, forumId?: string) { commit({ type: 'dialogs.patch', value: { moderators: { kind, threadId, forumId } } }) },
    openBoardSettings() { commit({ type: 'dialogs.patch', value: { boardSettings: true } }) },
    openBan(postIds: string[], threadId: string, deletePosts = false) { commit({ type: 'dialogs.patch', value: { banTarget: { postIds, threadId, deletePosts } } }) },
    openBans(title: string, kind: 'forum' | 'board' | 'thread', id: string, relayUrl?: string) { commit({ type: 'dialogs.patch', value: { bans: { title, kind, id, relayUrl } } }) },
    openLogs(tab: EntityKind, object?: EntityObject, relayUrl?: string) { commit({ type: 'dialogs.patch', value: { logs: { tab, object: object ?? null, relayUrl } } }) },
    openAuthorHistory(esid = '') { commit({ type: 'dialogs.patch', value: { authorHistory: esid.trim().replace(/^0x/i, '').toLowerCase() } }) },
    openTransaction(txid: string, relayUrl?: string) { commit({ type: 'dialogs.patch', value: { transaction: { txid: txid.replace(/^0x/i, '').toLowerCase(), relayUrl } } }) },
    openUnban(postId: string, threadId: string) { commit({ type: 'dialogs.patch', value: { unbanTarget: { postId, threadId } } }) },
    openGrantRole(postId: string, threadId: string) { commit({ type: 'dialogs.patch', value: { grantTarget: { postId, threadId } } }) },
    closeDialog(kind: keyof DialogState) { commit({ type: 'dialogs.patch', value: { [kind]: kind === 'boardSettings' ? false : null } }) },
    openGallery(forumId: string, postId: string, hash: string) { commit({ type: 'gallery.set', value: { forumId: forumKey(forumId), postId, hash } }) },
    closeGallery() { commit({ type: 'gallery.set', value: null }) },
    dismissNotification(id: number) { commit({ type: 'notification.remove', value: id }) }
  }
}
