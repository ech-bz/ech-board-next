import type { EntityKind, EntityObject } from '../../model/entities/entity'
import { forumKey } from '../../model/selectors/forum'
import type { DialogState } from '../../model/state/dialogs'
import { type Commit } from '../commit'


export function createOverlayCommands(commit: Commit) {
  return {
    openThreadTopic(threadId: string) { commit({ type: 'dialogs.patch', value: { topic: threadId } }) },
    openModerators(kind: 'forum' | 'board' | 'thread', threadId?: string) { commit({ type: 'dialogs.patch', value: { moderators: { kind, threadId } } }) },
    openBoardSettings() { commit({ type: 'dialogs.patch', value: { boardSettings: true } }) },
    openBan(postIds: string[], threadId: string, deletePosts = false) { commit({ type: 'dialogs.patch', value: { banTarget: { postIds, threadId, deletePosts } } }) },
    openBanId() { commit({ type: 'dialogs.patch', value: { banId: true } }) },
    openBans(title: string, kind: 'forum' | 'board' | 'thread', id: string) { commit({ type: 'dialogs.patch', value: { bans: { title, kind, id } } }) },
    openLogs(tab: EntityKind, object?: EntityObject) { commit({ type: 'dialogs.patch', value: { logs: { tab, object: object ?? null } } }) },
    closeDialog(kind: keyof DialogState) { commit({ type: 'dialogs.patch', value: { [kind]: kind === 'banId' || kind === 'boardSettings' ? false : null } }) },
    openGallery(forumId: string, postId: string, hash: string) { commit({ type: 'gallery.set', value: { forumId: forumKey(forumId), postId, hash } }) },
    closeGallery() { commit({ type: 'gallery.set', value: null }) },
    dismissNotification(id: number) { commit({ type: 'notification.remove', value: id }) }
  }
}
