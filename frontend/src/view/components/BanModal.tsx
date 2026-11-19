import { cva } from 'class-variance-authority'
import { createSignal, For, Show } from 'solid-js'
import { canBan, type BanScope } from '../../model/rules/permissions'
import type { RoleKind } from '../../model/rules/roles'
import { useI18n } from '../i18n'
import type { MessageKey } from '../i18n/ru'
import { Button } from './Button'
import { Field } from './Field'
import { Modal } from './Modal'

const sectionVariants = cva('mb-4')
const labelVariants = cva('mb-2 font-bold')
const rowVariants = cva('flex flex-wrap items-center gap-2')

const DURATIONS: { key: MessageKey; ms: number }[] = [
  { key: 'ban.dur1h', ms: 3600_000 },
  { key: 'ban.dur1d', ms: 86400_000 },
  { key: 'ban.dur7d', ms: 7 * 86400_000 },
  { key: 'ban.dur30d', ms: 30 * 86400_000 },
  { key: 'ban.dur365d', ms: 365 * 86400_000 },
  { key: 'ban.durForever', ms: 0 },
]

const SCOPE_LABELS: Record<BanScope, MessageKey> = {
  thread: 'ban.scopeThread',
  board: 'ban.scopeBoard',
  forum: 'ban.scopeForum',
}

export function BanModal(props: {
  scopes?: BanScope[]
  roleKinds: RoleKind[]
  busy?: boolean
  onClose: () => void
  onBan: (scope: BanScope, durationMs: number, reason: string) => void
}) {
  const { t } = useI18n()
  const [scope, setScope] = createSignal<BanScope>('thread')
  const [durationIdx, setDurationIdx] = createSignal(2)
  const [reason, setReason] = createSignal('')
  const scopes = () =>
    (['thread', 'board', 'forum'] as BanScope[]).filter(
      (entry) => canBan(entry, props.roleKinds) && (!props.scopes || props.scopes.includes(entry)),
    )
  const effectiveScope = () => (scopes().includes(scope()) ? scope() : (scopes()[0] ?? 'thread'))
  const canSubmit = () => scopes().length > 0
  return (
    <Modal title={t('ban.title')} onClose={props.onClose}>
      <div class={sectionVariants()}>
        <div class={labelVariants()}>{t('ban.scope')}</div>
        <Field as="select" value={effectiveScope()} onInput={(e) => setScope(e.currentTarget.value as BanScope)}>
          <For each={scopes()}>{(entry) => <option value={entry}>{t(SCOPE_LABELS[entry])}</option>}</For>
        </Field>
      </div>
      <div class={sectionVariants()}>
        <div class={labelVariants()}>{t('ban.duration')}</div>
        <Field as="select" value={String(durationIdx())} onInput={(e) => setDurationIdx(Number.parseInt(e.currentTarget.value, 10))}>
          <For each={DURATIONS}>
            {(entry, index) => <option value={String(index())}>{t(entry.key)}</option>}
          </For>
        </Field>
      </div>
      <div class={sectionVariants()}>
        <div class={labelVariants()}>{t('ban.reason')}</div>
        <div class={rowVariants()}>
          <Field as="input" grow="min-w-input" value={reason()} onInput={(e) => setReason(e.currentTarget.value)} />
          <Button
            disabled={props.busy || !canSubmit()}
            onClick={() =>
              props.onBan(effectiveScope(), DURATIONS[durationIdx()].ms, reason())
            }
          >
            {t('mod.save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
