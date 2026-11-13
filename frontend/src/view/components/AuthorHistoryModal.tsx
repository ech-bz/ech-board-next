import { createEffect, createSignal, Show } from 'solid-js'
import { useForumController } from '../bindings/forum'
import { useI18n } from '../i18n'
import { Button } from './Button'
import { Field } from './Field'
import { Modal } from './Modal'
import { HistoryView } from './debug/HistoryView'

export function AuthorHistoryModal(props: { esid: string; relayUrl: string; onClose: () => void }) {
  const { t } = useI18n()
  const controller = useForumController()
  const [esid, setEsid] = createSignal(props.esid)
  createEffect(() => setEsid(props.esid))
  return (
    <Modal title={t('history.author')} onClose={props.onClose}>
      <form class="mb-4 flex gap-2" onSubmit={(event) => {
        event.preventDefault()
        controller.openAuthorHistory(esid())
      }}>
        <Field class="min-w-0 flex-1 font-mono" aria-label="ESID" placeholder="ESID" value={esid()} required onInput={(event) => setEsid(event.currentTarget.value)} />
        <Button type="submit">{t('logs.search')}</Button>
      </form>
      <Show when={props.esid} keyed>
        {(id) => <HistoryView kind="author" entityId={id} relayUrl={props.relayUrl} />}
      </Show>
    </Modal>
  )
}
