import { cva } from 'class-variance-authority'
import { createEffect, createSignal, Show, type JSX } from 'solid-js'
import type { UserViewData } from '../../controller/forumGateway'
import { useForumController, useForumModel } from '../bindings/forum'
import { useEntityActions } from '../entityActions'
import { useErrors } from '../errors'
import { useI18n } from '../i18n'

const titleVariants = cva('mb-1 text-lg font-semibold text-fg leading-tight')
const descVariants = cva('mb-4 text-sm leading-normal text-secondary')
const listVariants = cva('flex flex-col')
const rowVariants = cva('flex items-baseline justify-between gap-4 border-b border-separator py-2 last:border-b-0')
const labelVariants = cva('text-secondary')
const valueVariants = cva('min-w-0 text-right [overflow-wrap:anywhere]')
const txVariants = cva('cursor-pointer border-0 bg-transparent p-0 text-accent [font:inherit]')

export function UserView() {
  const { t, months } = useI18n()
  const { reportError } = useErrors()
  const controller = useForumController()
  const model = useForumModel()
  const ea = useEntityActions()
  const [data, setData] = createSignal<UserViewData | null>(null)
  const [loaded, setLoaded] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  createEffect(() => {
    const relayUrl = model.navigation.context?.relayUrl
    if (!relayUrl) return
    setLoaded(false)
    setFailed(false)
    setData(null)
    void controller
      .loadUser(relayUrl)
      .then((value) => setData(value))
      .catch((error) => {
        setFailed(true)
        reportError(error)
      })
      .finally(() => setLoaded(true))
  })
  const time = (value: number) => {
    if (value <= 0) return t('settings.user.never')
    const date = new Date(value)
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${pad(date.getDate())} ${months()[date.getMonth()]} ${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }
  return (
    <div>
      <div class={titleVariants()}>{t('settings.info')}</div>
      <p class={descVariants()}>{t('settings.userDesc')}</p>
      <Show when={loaded()} fallback={<div class={labelVariants()}>{t('common.loading')}</div>}>
        <Show when={!failed()} fallback={<div class={labelVariants()}>{t('settings.userUnavailable')}</div>}>
          <Show when={data()} fallback={<div class={labelVariants()}>{t('settings.userMissing')}</div>}>
          {(user) => (
            <div class={listVariants()}>
              <Row label={t('settings.user.posts')}>
                <span class={valueVariants()}>{user().postCount.toLocaleString()}</span>
              </Row>
              <Row label={t('settings.user.threads')}>
                <span class={valueVariants()}>{user().threadCount.toLocaleString()}</span>
              </Row>
              <Row label={t('settings.user.lastPost')}>
                <span class={valueVariants()}>{time(user().lastPost)}</span>
              </Row>
              <Row label={t('settings.user.lastReaction')}>
                <span class={valueVariants()}>{time(user().lastReaction)}</span>
              </Row>
              <Row label={t('settings.user.genesis')}>
                <button type="button" class={txVariants()} onClick={() => ea.openTransaction(user().genesis)}>
                  {short(user().genesis)}
                </button>
              </Row>
              <Row label={t('settings.user.id')}>
                <span class={valueVariants()}>{short(user().sid)}</span>
              </Row>
            </div>
          )}
          </Show>
        </Show>
      </Show>
    </div>
  )
}

function Row(props: { label: string; children: JSX.Element }) {
  return (
    <div class={rowVariants()}>
      <span class={labelVariants()}>{props.label}</span>
      {props.children}
    </div>
  )
}

function short(value: string) {
  const clean = value.replace(/^0x/, '')
  return `${clean.slice(0, 12)}…${clean.slice(-8)}`
}
