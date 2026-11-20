import { createSignal, For, Show } from 'solid-js'
import { identityKey } from '../../model/rules/identity'
import { useForumQueries } from '../bindings/forum'
import { useI18n } from '../i18n'
import type { MessageKey } from '../i18n/ru'
import { useMod } from '../mod'
import { Button } from './Button'
import { Field } from './Field'
import { Modal } from './Modal'

type GrantRole = 'thread_admin' | 'thread_mod' | 'board_mod'

const rowVariants = 'flex items-center justify-between gap-3 border-b border-separator py-2'
const controlsVariants = 'flex flex-wrap items-center gap-2'

const ROLE_ORDER: GrantRole[] = ['board_mod', 'thread_admin', 'thread_mod']

const ROLE_LABELS: Record<GrantRole, MessageKey> = {
  thread_admin: 'assign.admin',
  thread_mod: 'assign.thread',
  board_mod: 'assign.board',
}

const clean = (value: string) => value.replace(/^0x/, '').toLowerCase()

export function GrantRoleModal(props: {
  postId: string
  threadId: string
  canThread: boolean
  canBoard: boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  const read = useForumQueries()
  const mod = useMod()
  const post = () => read.get(props.postId)
  const author = () => post()?.author ?? null
  const moderators = () => read.moderatorsOf(props.threadId)
  const [boardId, setBoardId] = createSignal(read.info()?.boardId ?? '')
  const boardTarget = () => boardId() || read.info()?.boardId || ''
  const has = (list: { tweak: Uint8Array; c1: Uint8Array; c2: Uint8Array }[], target: string) =>
    list.some((identity) => clean(identityKey(identity)) === clean(target))
  const assigned = (role: GrantRole) => {
    const target = author()
    if (!target) return true
    const mods = moderators()
    if (role === 'thread_admin') return mods.thread_admin !== null && clean(identityKey(mods.thread_admin)) === clean(target)
    if (role === 'thread_mod') return has(mods.thread_mods, target)
    return has(read.boardModeratorsOf(boardTarget()), target)
  }
  const roles = () => ROLE_ORDER.filter((role) => (role === 'board_mod' ? props.canBoard : props.canThread))
  const grant = (role: GrantRole) => {
    const target = author()
    if (!target) return
    if (role === 'thread_admin') void mod.runThreadSetAdmin(props.threadId, target)
    else if (role === 'thread_mod') void mod.runThreadAddModerator(props.threadId, target)
    else void mod.runBoardAddModerator(boardTarget(), target)
  }
  const revoke = (role: GrantRole) => {
    const target = author()
    if (!target) return
    if (role === 'thread_admin') void mod.runThreadSetAdmin(props.threadId, null)
    else if (role === 'thread_mod') void mod.runThreadDelModerator(props.threadId, target)
    else void mod.runBoardDelModerator(boardTarget(), target)
  }
  return (
    <Modal title={t('mod.grantRole')} onClose={props.onClose}>
      <For each={roles()}>
        {(role) => (
          <div class={rowVariants}>
            <span>{t(ROLE_LABELS[role])}</span>
            <div class={controlsVariants}>
              <Show when={role === 'board_mod'}>
                <Field as="select" value={boardTarget()} onInput={(e) => setBoardId(e.currentTarget.value)}>
                  <For each={read.boards()}>{(board) => <option value={board.id}>/{board.slug}/</option>}</For>
                </Field>
              </Show>
              <Button size="sm" disabled={mod.busy() || !author()} onClick={() => (assigned(role) ? revoke(role) : grant(role))}>
                {t(assigned(role) ? 'assign.revoke' : 'assign.grant')}
              </Button>
            </div>
          </div>
        )}
      </For>
    </Modal>
  )
}
