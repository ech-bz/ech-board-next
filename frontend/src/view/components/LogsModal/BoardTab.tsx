import { Show } from 'solid-js'
import { useForumQueries } from '../../bindings/forum'
import { useI18n } from '../../i18n'
import { EntityDebugBody } from '../debug/EntityDebugBody'

export function BoardTab(props: { relayUrl: string; boardId?: string }) {
  const { t } = useI18n()
  const read = useForumQueries()
  const id = () => read.boardObject()?.id ?? props.boardId
  return <Show when={id()} fallback={<p class="my-1 text-md text-secondary">{t('logs.emptyBoard')}</p>}>{(id) => <EntityDebugBody object={{ kind: 'board', id: id() }} relayUrl={props.relayUrl} />}</Show>
}
