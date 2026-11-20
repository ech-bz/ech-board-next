import { useErrors } from '../errors'
import { cva } from 'class-variance-authority'
import { createEffect, For, Show } from 'solid-js'
import { shortHex } from '../../model/content/hex'
import { resourceKey } from '../../model/state/resources'
import { useForumController, useForumModel } from '../bindings/forum'
import { useI18n } from '../i18n'
import { useMod } from '../mod'
import { useModals } from '../modals'
import { Button } from './Button'
import { Modal } from './Modal'

const errorVariants = cva('my-1 text-md text-danger')
const emptyVariants = cva('my-1 text-md text-secondary')
const rowVariants = cva('flex flex-col items-start gap-1 border-b border-separator py-2 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-3 sm:gap-y-1')
const targetVariants = cva('self-start border-0 bg-transparent p-0 text-left font-mono text-sm text-accent cursor-pointer hover:underline break-all')
const dateVariants = cva('text-sm text-secondary whitespace-nowrap')
const reasonVariants = cva('min-w-0 flex-1 break-words')

export function BansModal(props: { title: string; relayUrl: string; kind: 'forum' | 'board' | 'thread'; id: string; onClose: () => void }) {
  const { t } = useI18n()
  const { errorMessage } = useErrors()
  const controller = useForumController()
  const model = useForumModel()
  const mod = useMod()
  const modals = useModals()
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
        <div>
          <For each={bans()}>
            {(ban) => (
              <div class={rowVariants()}>
                <button type="button" class={targetVariants()} title={ban.target} onClick={() => modals.openTransaction(ban.target)}>{shortHex(ban.target)}</button>
                <span class={reasonVariants()}>{ban.reason ? ban.reason : t('bans.noData')}</span>
                <span class={dateVariants()}>{ban.expires === null ? t('bans.permanent') : new Date(ban.expires).toLocaleString()}</span>
                <Button
                  size="sm"
                  class="self-start whitespace-nowrap sm:ml-auto"
                  disabled={mod.busy()}
                  onClick={async () => {
                    await mod.runUnban(ban.target, ban.author, props.kind, props.id)
                    void controller.loadBans(props.relayUrl, props.kind, props.id)
                  }}
                >
                  {t('mod.unban')}
                </Button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </Modal>
  )
}
