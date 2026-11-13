import { useErrors } from '../errors'
import { cva } from 'class-variance-authority'
import { createEffect, For, Show } from 'solid-js'
import { resourceKey } from '../../model/state/resources'
import { useForumController, useForumModel } from '../bindings/forum'
import { useI18n } from '../i18n'
import { Modal } from './Modal'

const errorVariants = cva('my-1 text-md text-danger')
const emptyVariants = cva('my-1 text-md text-secondary')
const tableVariants = cva('w-full border-collapse')
const thVariants = cva('border-b border-separator px-2.5 py-2 text-left align-top font-semibold break-all')
const tdVariants = cva('border-b border-separator px-2.5 py-2 text-left align-top break-all')

export function BansModal(props: { title: string; relayUrl: string; kind: 'forum' | 'board' | 'thread'; id: string; onClose: () => void }) {
  const { t } = useI18n()
  const { errorMessage } = useErrors()
  const controller = useForumController()
  const model = useForumModel()
  const state = () => model.resources.bans[resourceKey(props.relayUrl, props.kind, props.id)]
  const bans = () => state()?.items ?? []
  const loading = () => state()?.loading ?? false
  const error = () => state()?.error ?? null
  createEffect(() => {
    if (props.relayUrl && props.id) void controller.loadBans(props.relayUrl, props.kind, props.id)
  })

  return (
    <Modal title={props.title} onClose={props.onClose}>
      <Show when={error()}>{(message) => <div class={errorVariants()}>{errorMessage(message())}</div>}</Show>
      <Show when={bans().length === 0 && !loading()}>
        <p class={emptyVariants()}>{t('bans.empty')}</p>
      </Show>
      <Show when={bans().length > 0}>
        <table class={tableVariants()}>
          <thead>
            <tr>
              <th class={thVariants()}>{t('bans.ip')}</th>
              <th class={thVariants()}>{t('bans.reason')}</th>
              <th class={thVariants()}>{t('bans.expires')}</th>
            </tr>
          </thead>
          <tbody>
            <For each={bans()}>
              {(ban) => (
                <tr>
                  <td class={tdVariants()}>{ban.author}</td>
                  <td class={tdVariants()}>{ban.reason ? ban.reason : t('bans.noData')}</td>
                  <td class={tdVariants()}>{new Date(ban.expires).toLocaleString()}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </Modal>
  )
}
