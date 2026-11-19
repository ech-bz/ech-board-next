import { useErrors } from '../errors'
import { cva } from 'class-variance-authority'
import { createEffect, For, Show } from 'solid-js'
import { shortHex } from '../../model/content/hex'
import { resourceKey } from '../../model/state/resources'
import { useForumController, useForumModel } from '../bindings/forum'
import { useI18n } from '../i18n'
import { useMod } from '../mod'
import { Button } from './Button'
import { Modal } from './Modal'

const errorVariants = cva('my-1 text-md text-danger')
const emptyVariants = cva('my-1 text-md text-secondary')
const rowVariants = cva('flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-separator py-2')
const targetVariants = cva('font-mono text-sm')
const dateVariants = cva('text-sm text-secondary whitespace-nowrap')
const reasonVariants = cva('min-w-0 flex-1 break-words')

export function BansModal(props: { title: string; relayUrl: string; kind: 'forum' | 'board' | 'thread'; id: string; onClose: () => void }) {
  const { t } = useI18n()
  const { errorMessage } = useErrors()
  const controller = useForumController()
  const model = useForumModel()
  const mod = useMod()
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
                <span class={targetVariants()} title={ban.target}>{shortHex(ban.target)}</span>
                <span class={reasonVariants()}>{ban.reason ? ban.reason : t('bans.noData')}</span>
                <span class={dateVariants()}>{ban.expires === null ? t('bans.permanent') : new Date(ban.expires).toLocaleString()}</span>
                <Button
                  size="sm"
                  class="ml-auto whitespace-nowrap"
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
