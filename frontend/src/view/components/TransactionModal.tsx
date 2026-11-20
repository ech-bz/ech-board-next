import { createEffect, createSignal, Show } from 'solid-js'
import { useForumController } from '../bindings/forum'
import { formatDebugValue } from '../../controller/convert/debug'
import type { Tx } from '../../controller/io/ech/protocol/entities'
import { useI18n } from '../i18n'
import { Button } from './Button'
import { JsonTree } from './debug/JsonTree'
import { Field } from './Field'
import { Modal } from './Modal'

const bodyVariants = 'max-h-debug overflow-y-auto font-mono text-sm text-secondary'
const formVariants = 'mb-4 flex gap-2'

export function TransactionModal(props: { txid: string; relayUrl: string; onClose: () => void }) {
  const { t } = useI18n()
  const controller = useForumController()
  const [input, setInput] = createSignal(props.txid)
  const [tx, setTx] = createSignal<Tx | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const load = async (raw: string) => {
    const txid = raw.trim().replace(/^0x/i, '').toLowerCase()
    setTx(null)
    if (!/^[0-9a-f]{64}$/.test(txid)) {
      setError(t('tx.invalid'))
      return
    }
    setError(null)
    try {
      const value = await controller.transaction(props.relayUrl, txid)
      if (value) setTx(value)
      else setError(t('tx.notFound'))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }
  createEffect(() => {
    const txid = props.txid
    setInput(txid)
    setTx(null)
    setError(null)
    if (txid) void load(txid)
  })
  return (
    <Modal title={t('tx.title')} onClose={props.onClose}>
      <form class={formVariants} onSubmit={(event) => { event.preventDefault(); void load(input()) }}>
        <Field class="min-w-0 flex-1 font-mono" aria-label="TXID" placeholder="TXID" value={input()} required onInput={(event) => setInput(event.currentTarget.value)} />
        <Button type="submit">{t('tx.show')}</Button>
      </form>
      <Show when={tx()} keyed>
        {(value) => (
          <div class={bodyVariants}>
            <JsonTree data={formatDebugValue(value)} />
          </div>
        )}
      </Show>
      <Show when={error()}>{(message) => <p class={'my-1 text-md text-danger'}>{message()}</p>}</Show>
    </Modal>
  )
}
