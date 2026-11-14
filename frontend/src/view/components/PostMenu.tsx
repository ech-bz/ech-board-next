import type { Thread } from '../../model/entities/thread'

import type { Post } from '../../model/entities/post'
import { canBanById, canSelectAllFromAuthor, type BanScope } from '../../model/rules/permissions'
import { useForumController, useForumQueries } from '../bindings/forum'
import { useEntityActions } from '../entityActions'
import { useI18n } from '../i18n'
import { usePostSelection } from '../postSelection/PostSelectionProvider'
import { threadModItems } from '../threadModItems'
import { DropdownMenu, type MenuItem } from './Menu/DropdownMenu'

export function PostMenu(props: { post: Post; closed: boolean; threadObject?: Thread; onEdit?: (id: string) => void }) {
  const { t } = useI18n()
  const actions = useEntityActions()
  const read = useForumQueries()
  const controller = useForumController()
  const selection = usePostSelection()
  const items = (): MenuItem[] => {
    const rec = props.post
    const result: MenuItem[] = [
      { label: t('report.title'), onClick: () => actions.openReport({ board: rec.board, threadNum: rec.threadNumber, postNum: rec.number }) },
    ]
    if (rec.author) result.push({ label: t('history.author'), onClick: () => controller.openAuthorHistory(rec.author!) })
    if (props.onEdit && rec.canEdit) result.push({ label: t('mod.edit'), onClick: () => props.onEdit?.(rec.id) })
    const author = (): MenuItem => ({ label: t('mod.selectAllFromAuthor'), onClick: () => selection?.selectAllFromAuthor(rec, rec.threadId) })
    if (rec.op) {
      result.push(...threadModItems(t, actions, { threadId: rec.threadId, closed: props.closed, deleted: rec.hidden }))
      result.push({ label: t('mod.moderators'), onClick: () => actions.openThreadModerators(rec.threadId) })
      result.push({ label: t('mod.bans'), onClick: () => actions.openBans(t('mod.bans'), 'thread', rec.threadId) })
      if (actions.canBanAny() && canBanById(actions.roleKinds())) result.push({ label: t('mod.banId'), onClick: () => actions.openBanId() })
      if (selection?.canSelect() && canSelectAllFromAuthor(actions.roleKinds())) result.push(author())
      result.push({ label: t('mod.debugThread'), onClick: () => actions.openLogs('thread', props.threadObject ? { kind: 'thread', id: props.threadObject.id } : undefined) })
      result.push({ label: t('mod.debugPost'), onClick: () => actions.openLogs('post', { kind: 'post', id: rec.id }) })
      return result
    }
    const threadId = rec.threadId
    if (rec.canDelete) result.push({ label: t('mod.delete'), onClick: () => actions.runPostDelete(rec, threadId, 'delete') })
    if (rec.canRestore) result.push({ label: t('mod.restore'), onClick: () => actions.runPostDelete(rec, threadId, 'restore') })
    if (actions.canBanAny() && !rec.hidden && !rec.banned) {
      result.push({ label: t('mod.ban'), onClick: () => actions.openBan([rec], threadId) })
    }
    if (rec.banned && rec.bannedLevel) {
      const info = read.info()
      const level = rec.bannedLevel
      const scope: BanScope = level === threadId ? 'thread' : level === info?.boardId ? 'board' : 'forum'
      if (actions.canBanScope(scope) && info) {
        result.push({ label: t('mod.unban'), onClick: () => actions.runUnban(rec, threadId, scope) })
      }
    }
    if (selection?.canSelect() && canSelectAllFromAuthor(actions.roleKinds())) result.push(author())
    result.push({ label: t('mod.debugPost'), onClick: () => actions.openLogs('post', { kind: 'post', id: rec.id }) })
    return result
  }
  return (
    <DropdownMenu
      items={items()}
      postTrigger
      hasItems
      triggerSize="xs"
      iconSize={14}
      triggerShape="rounded"
      class="ml-auto self-start"
    />
  )
}
