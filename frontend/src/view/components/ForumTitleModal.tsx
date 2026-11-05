import { createSignal, Show } from 'solid-js'
import { useI18n } from '../i18n'
import { Button } from './Button'
import { Field } from './Field'
import { Modal } from './Modal'

export function ForumTitleModal(props: {
  initial: string
  busy: boolean
  allowed: boolean
  onSave: (title: string) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [title, setTitle] = createSignal(props.initial)
  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    if (!props.busy && props.allowed && title().trim()) props.onSave(title().trim())
  }

  return (
    <Modal title={t('forum.editTitle')} onClose={props.onClose}>
      <form class="flex flex-col gap-4" onSubmit={submit}>
        <label class="flex flex-col gap-2">
          <span>{t('forum.title')}</span>
          <Field value={title()} autofocus required disabled={props.busy} onInput={(event) => setTitle(event.currentTarget.value)} />
        </label>
        <Show when={!props.allowed}>
          <p class="text-danger">{t('error.NotAuthorized')}</p>
        </Show>
        <div class="flex justify-end gap-2">
          <Button onClick={props.onClose}>{t('mod.cancel')}</Button>
          <Button type="submit" disabled={props.busy || !props.allowed || !title().trim()}>
            {props.busy ? t('common.loading') : t('mod.save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
