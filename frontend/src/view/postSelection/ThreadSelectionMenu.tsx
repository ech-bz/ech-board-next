import { Show } from 'solid-js'
import { useForumController, useForumModel } from '../bindings/forum'
import { DropdownMenu, type MenuItem } from '../components/Menu/DropdownMenu'
import { useEntityActions } from '../entityActions'
import { useI18n } from '../i18n'
import { usePostSelection } from './PostSelectionProvider'
import { ProgressPill } from './ProgressPill'

export function ThreadSelectionMenu(props: { items: MenuItem[]; class?: string; variant?: 'glass' }) {
  const { t } = useI18n()
  const sel = usePostSelection()
  const ea = useEntityActions()
  const model = useForumModel()
  const controller = useForumController()
  const run = () => model.operations.selectionProgress
  const items = (): MenuItem[] => {
    const all = [...props.items]
    if (!sel || !sel.hasSelection()) return all
    const selected = sel.selected()
    const threadId = ea.threadId()
    const selectedPosts = ea.selectedPosts(selected)
    const deleted = ea.deletedCount(selected)
    const live = selected.size - deleted
    if (deleted > 0 && threadId) {
      all.push({
        label: t('select.restoreSelected', { n: deleted }),
        onClick: () => controller.selection.moderate('restore').catch(() => undefined),
      })
    }
    if (live > 0 && threadId) {
      all.push({
        label: t('select.deleteSelected', { n: live }),
        danger: true,
        onClick: () => controller.selection.moderate('delete').catch(() => undefined),
      })
    }
    if (ea.canBanAny() && threadId) {
      all.push({ label: t('select.banSelected', { n: selected.size }), danger: true, onClick: () => ea.openBan(selectedPosts, threadId) })
      all.push({
        label: t('select.deleteBanSelected', { n: selected.size }),
        danger: true,
        onClick: () => ea.openBan(selectedPosts, threadId, true),
      })
    }
    all.push({ label: t('select.clear'), onClick: () => sel.clear() })
    return all
  }
  return (
    <>
      <DropdownMenu items={items()} class={props.class} triggerVariant={props.variant} />
      <Show when={run()}>
        {(progress) => <ProgressPill label={t('select.progress', { done: progress().done, total: progress().total })} />}
      </Show>
    </>
  )
}
