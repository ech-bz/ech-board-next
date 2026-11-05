import { cva } from 'class-variance-authority'
import { Show, type JSX } from 'solid-js'
import type { PostPart } from '../../model/content/postPart'
import { secretKey, type SecretContent } from '../../model/content/secrets'
import { useForumController, useForumModel } from '../bindings/forum'
import { reportError } from '../errors'
import { useI18n } from '../i18n'

const secretSpanVariants = cva('cursor-pointer font-mono text-accent')

export function SecretSpan(props: {
  secret: SecretContent
  forumId: string
  author: string
  renderNested: (parts: PostPart[]) => JSX.Element
}) {
  const { t } = useI18n()
  const controller = useForumController()
  const model = useForumModel()
  const state = () => model.resources.secrets[secretKey(props.forumId, props.author, props.secret)]
  const reveal = async () => {
    await controller.revealSecret(props.forumId, props.author, props.secret)
    if (state()?.error) reportError(t('post.secretDecryptFailed'))
  }
  return (
    <Show when={state()?.parts} fallback={<span class={secretSpanVariants()} onClick={() => void reveal()}>{`[${t('post.secret')}]`}</span>}>
      {(parts) => props.renderNested(parts())}
    </Show>
  )
}
