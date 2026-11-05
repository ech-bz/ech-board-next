import { createSignal, Show } from 'solid-js'
import { validBoardSlug } from '../../model/rules/board'
import { useI18n } from '../i18n'
import { Button } from './Button'
import { Field } from './Field'
import { Modal } from './Modal'

export function CreateBoardModal(props: {
  busy: boolean
  allowed: boolean
  onCreate: (slug: string, description: string) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [slug, setSlug] = createSignal('')
  const [description, setDescription] = createSignal('')
  const valid = () => validBoardSlug(slug().trim())
  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    if (!props.busy && props.allowed && valid()) props.onCreate(slug().trim(), description())
  }

  return (
    <Modal title={t('forum.createBoard')} onClose={props.onClose}>
      <form class="flex flex-col gap-4" onSubmit={submit}>
        <label class="flex flex-col gap-2">
          <span>{t('forum.boardSlug')}</span>
          <Field value={slug()} autofocus required maxLength={32} disabled={props.busy} spellcheck={false} autocapitalize="none" placeholder="b" onInput={(event) => setSlug(event.currentTarget.value)} aria-invalid={slug().length > 0 && !valid()} />
          <span class="text-sm text-secondary">{t('forum.boardSlugHint')}</span>
        </label>
        <label class="flex flex-col gap-2">
          <span>{t('forum.boardDescription')}</span>
          <Field value={description()} disabled={props.busy} onInput={(event) => setDescription(event.currentTarget.value)} />
        </label>
        <Show when={!props.allowed}>
          <p class="text-danger">{t('error.NotAuthorized')}</p>
        </Show>
        <div class="flex justify-end gap-2">
          <Button onClick={props.onClose}>{t('mod.cancel')}</Button>
          <Button type="submit" disabled={props.busy || !props.allowed || !valid()}>
            {props.busy ? t('common.loading') : t('forum.createBoard')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
