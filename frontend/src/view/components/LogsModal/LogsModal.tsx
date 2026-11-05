import { Show } from 'solid-js'
import type { EntityObject } from '../../../model/entities/entity'
import { useI18n } from '../../i18n'
import { Modal } from '../Modal'
import { EntityDebugBody } from '../debug/EntityDebugBody'
import { BoardTab } from './BoardTab'
import { ForumTab } from './ForumTab'

export type LogsTab = 'forum' | 'board' | 'thread' | 'post'

export function LogsModal(props: {
  tab: LogsTab
  relayUrl: string
  boardId?: string
  object?: EntityObject | null
  onClose: () => void
}) {
  const { t } = useI18n()
  return (
    <Modal title={t('logs.title')} onClose={props.onClose}>
      <Show
        when={props.object}
        fallback={
          <Show when={props.tab === 'forum'} fallback={<BoardTab relayUrl={props.relayUrl} boardId={props.boardId} />}>
            <ForumTab relayUrl={props.relayUrl} />
          </Show>
        }
      >
        {(object) => (
          <EntityDebugBody
            object={object()}
            relayUrl={props.relayUrl}
          />
        )}
      </Show>
    </Modal>
  )
}
