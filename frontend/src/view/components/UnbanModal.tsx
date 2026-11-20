import { For, Show } from 'solid-js'
import { toHex } from '../../model/content/hex'
import type { BanScope } from '../../model/rules/permissions'
import { useForumQueries } from '../bindings/forum'
import { banScopeLabel } from '../banScopeLabel'
import { useI18n } from '../i18n'
import { useMod } from '../mod'
import { Button } from './Button'
import { Modal } from './Modal'

const rowVariants = 'flex items-center justify-between gap-3 border-b border-separator py-2'
const emptyVariants = 'my-1 text-md text-secondary'

export function UnbanModal(props: { postId: string; threadId: string; onClose: () => void }) {
  const { t } = useI18n()
  const read = useForumQueries()
  const mod = useMod()
  const post = () => read.get(props.postId)
  const scopes = () => post()?.bannedScopes ?? []
  const targetId = (scope: BanScope) => scope === 'thread' ? props.threadId : scope === 'board' ? read.info()?.boardId ?? '' : ''
  const run = (scope: BanScope) => {
    const record = post()
    if (!record?.author) return
    void mod.runUnban(toHex(record.txid), record.author, scope, targetId(scope))
  }
  return (
    <Modal title={t('mod.unban')} onClose={props.onClose}>
      <Show when={scopes().length === 0}>
        <p class={emptyVariants}>{t('bans.empty')}</p>
      </Show>
      <For each={scopes()}>
        {(scope) => (
          <div class={rowVariants}>
            <span>{banScopeLabel(t, scope)}</span>
            <Button size="sm" disabled={mod.busy() || !post()?.author} onClick={() => run(scope)}>
              {t('mod.unban')}
            </Button>
          </div>
        )}
      </For>
    </Modal>
  )
}
