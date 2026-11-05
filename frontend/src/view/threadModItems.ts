import type { MenuItem } from './components/Menu/DropdownMenu';
import type { EntityActions } from './entityActions';
import type { MessageKey } from './i18n/ru';

export function threadModItems(
  t: (key: MessageKey) => string,
  ea: EntityActions,
  u: { threadId: string; closed: boolean; deleted: boolean },
): MenuItem[] {
  const items: MenuItem[] = []
  const { threadId, closed, deleted } = u
  if (deleted) {
    if (ea.canThreadRestore(threadId)) items.push({ label: t('mod.restoreThread'), onClick: () => ea.runThreadAction('restore', threadId) })
  } else {
    if (closed) {
      if (ea.canThreadOpen(threadId)) items.push({ label: t('mod.open'), onClick: () => ea.runThreadAction('open', threadId) })
      if (ea.canThreadDelete(threadId)) items.push({ label: t('mod.deleteThread'), onClick: () => ea.runThreadAction('delete', threadId) })
    } else {
      if (ea.canThreadClose(threadId)) items.push({ label: t('mod.close'), onClick: () => ea.runThreadAction('close', threadId) })
      if (ea.canThreadDelete(threadId)) items.push({ label: t('mod.closeDelete'), onClick: () => ea.runThreadCloseDelete(threadId) })
    }
    if (ea.canThreadEditTopic(threadId)) items.push({ label: t('mod.editTopic'), onClick: () => ea.openThreadTopic(threadId) })
  }
  if (!deleted && ea.canThreadPin(threadId)) {
    items.push({
      label: t(ea.isThreadPinned(threadId) ? 'mod.unpin' : 'mod.pin'),
      onClick: () => ea.toggleThreadPin(threadId),
    })
  }
  return items
}
