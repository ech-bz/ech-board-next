import { cva } from 'class-variance-authority'
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js'
import type { HistoryKind } from '../../../model/state/inspection'
import { resourceKey } from '../../../model/state/resources'
import { useForumController, useForumModel } from '../../bindings/forum'
import { useI18n } from '../../i18n'
import { JsonTree } from './JsonTree'

const statusVariants = cva('my-1 text-md text-secondary')
const errorVariants = cva('my-1 text-md text-danger')
const scrollVariants = cva('flex max-h-debug flex-col gap-1 overflow-y-auto')
const itemVariants = cva('flex-none overflow-hidden rounded-md border border-separator')
const summaryVariants = cva('cursor-pointer select-text overflow-hidden text-ellipsis whitespace-nowrap px-2 py-1 text-sm leading-snug text-secondary')
const kindVariants = cva('mr-1 text-sm font-bold text-accent')
const fieldsVariants = cva('text-sm text-secondary break-all')
const bodyVariants = cva('border-t border-separator px-1.5 py-1.5 font-mono text-sm text-secondary')

export function HistoryView(props: { entityId: string; kind: HistoryKind; relayUrl: string }) {
  const { t } = useI18n()
  const controller = useForumController()
  const model = useForumModel()
  const state = () => model.resources.history[resourceKey(props.relayUrl, props.kind, props.entityId)]
  const items = () => state()?.items ?? []
  const nextCursor = () => state()?.next ?? null
  const loading = () => state()?.loading ?? false
  const loadingMore = () => state()?.loadingMore ?? false
  const error = () => state()?.error ?? null
  const [expanded, setExpanded] = createSignal<Set<number>>(new Set())
  let sentinel: HTMLDivElement | undefined
  let scroller: HTMLDivElement | undefined

  const loadMore = () => controller.loadHistory(props.relayUrl, props.kind, props.entityId, true)

  const toggle = (idx: number) => {
    const next = new Set(expanded())
    if (next.has(idx)) next.delete(idx)
    else next.add(idx)
    setExpanded(next)
  }

  createEffect(() => {
    void controller.loadHistory(props.relayUrl, props.kind, props.entityId)
  })

  createEffect(() => {
    if (!nextCursor() || loading() || loadingMore() || error()) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void loadMore()
    }, { root: scroller ?? null, threshold: 0 })
    if (sentinel) observer.observe(sentinel)
    onCleanup(() => observer.disconnect())
  })

  return (
    <div ref={scroller} class={scrollVariants()}>
      <Show when={loading()}>
        <p class={statusVariants()}>{t('history.loading')}</p>
      </Show>
      <Show when={error()}>{(message) => <div class={errorVariants()}>{message()}</div>}</Show>
      <Show when={!loading() && !error() && items().length === 0}>
        <p class={statusVariants()}>{t('history.noEvents')}</p>
      </Show>
      <For each={items()}>
        {(event, index) => {
          const isExpanded = () => expanded().has(index())
          return (
            <div class={itemVariants()}>
              <div
                class={summaryVariants()}
                onClick={() => {
                  const selection = window.getSelection()
                  if (selection && selection.toString().length > 0) return
                  toggle(index())
                }}
              >
                <span class={kindVariants()}>
                  <Show when={event.number !== null}>#{event.number?.toString()} </Show>
                  {event.function}
                </span>
                <Show when={!isExpanded()}>
                  <span class={fieldsVariants()}>{new Date(event.time).toLocaleString()}</span>
                </Show>
              </div>
              <Show when={isExpanded()}>
                <div class={bodyVariants()}>
                  <JsonTree data={event.tx} />
                </div>
              </Show>
            </div>
          )
        }}
      </For>
      <div ref={sentinel} style={{ height: '1px' }} />
      <Show when={loadingMore()}>
        <p class={statusVariants()}>{t('history.loadingMore')}</p>
      </Show>
    </div>
  )
}
