import { cva } from 'class-variance-authority'
import { Show } from 'solid-js'
import type { Thread } from '../../model/entities/thread'
import { useForumController, useForumModel, useForumQueries, usePostModel, usePostSource, useThreadModel } from '../bindings/forum'
import { useI18n } from '../i18n'
import { useRoutes } from '../route'
import { Button } from './Button'
import { PostBody } from './Post'

const sectionVariants = cva('mb-6 pr-3.5')
const hiddenLabelVariants = cva('cursor-pointer px-0.5 py-1 text-lg italic text-secondary')
const separatorVariants = cva('mt-6 h-px bg-separator opacity-50')
const topicRowVariants = cva('flex items-center gap-2 px-0.5 pb-2')
const topicVariants = cva('min-w-0 flex-1 text-xl font-bold [overflow-wrap:anywhere]')
const postsColumnVariants = cva('flex w-fit max-w-full flex-col')
const actionRowVariants = cva('flex items-center gap-2 pb-2 max-w-post')
const skippedVariants = cva('text-sm text-secondary')
const spacerVariants = cva('flex-1')

export function ThreadPreview(props: {
  id: string
  forumId: string
  slug?: string
  onOpen: (number: number) => void
}) {
  const { threadPath } = useRoutes()
  const { t, hideThreadsCompletely } = useI18n()
  const store = useForumController()
  const read = useForumQueries()
  const post = useThreadModel(props.id)
  const model = useForumModel()
  const hidden = () => model.preferences.hiddenThreads.includes(props.id)
  const op = usePostSource(() => post()?.opId ?? '')
  const ctx = () =>
    read.info()
      ? { relayUrl: read.info()!.relayUrl, forumId: read.info()!.forumId, boardId: read.info()!.boardId }
      : null
  const opView = () => {
    const post = op()
    const context = ctx()
    return post && context ? { post: post, ctx: context } : null
  }
  const hide = () => {
    store.setThreadHidden(props.id, true)
  }
  return (
    <Show when={post()}>
      {(row) => (
        <Show when={!hidden() || !hideThreadsCompletely()}>
          <Show
            when={!hidden()}
            fallback={
              <section class={sectionVariants()}>
                <div
                  class={hiddenLabelVariants()}
                  onClick={() => {
                    store.setThreadHidden(props.id, false)
                  }}
                >
                  <em>
                    {t('thread.hidden', { num: row().number })}
                    {row().title ? ` (${row().title})` : ''}
                  </em>
                </div>
                <div class={separatorVariants()} />
              </section>
            }
          >
            <section class={sectionVariants()} data-post-column="">
              <Show when={row().topic}>
                <div class={topicRowVariants()}>
                  <div class={topicVariants()}>{row().topic}</div>
                </div>
              </Show>
              <div class={postsColumnVariants()}>
                <Show when={opView()}>
                  {(view) => (
                    <PostBody
                      post={view().post}
                      ctx={view().ctx}
                      threadClosed={row().closed}
                      threadBroom={row().opAdmin}
                      pinned={row().isPinned}
                      slug={props.slug}
                      threadNum={row().number}
                      boardPage
                    />
                  )}
                </Show>
                <div class={actionRowVariants()}>
                  <Show when={row().skipped > 0}>
                    <span class={skippedVariants()}>{t('thread.skipped', { n: row().skipped })}</span>
                  </Show>
                  <span class={spacerVariants()} />
                  <Button size="sm" intent="accent" onClick={hide}>
                    {t('thread.hide')}
                  </Button>
                  <Button
                    size="sm"
                    intent="accent"
                    href={props.slug ? threadPath(props.forumId, props.slug, row().number) : undefined}
                    onClick={(e) => {
                      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
                      e.preventDefault()
                      props.onOpen(row().number)
                    }}
                  >
                    {t('thread.open')}
                  </Button>
                </div>
              </div>
              {row().replyIds.map((id) => (
                <ThreadPreviewReply id={id} row={row()} slug={props.slug} />
              ))}
              <div class={separatorVariants()} />
            </section>
          </Show>
        </Show>
      )}
    </Show>
  )
}

function ThreadPreviewReply(props: { id: string; row: Thread; slug?: string }) {
  const read = useForumQueries()
  const post = usePostModel(props.id)
  const view = () => {
    const rec = post()
    if (!rec) return null
    const info = read.info()
    if (!info) return null
    return {
      post: rec,
      ctx: { relayUrl: info.relayUrl, forumId: info.forumId, boardId: info.boardId },
    }
  }
  return (
    <Show when={view()}>
      {(entry) => (
        <PostBody
          post={entry().post}
          ctx={entry().ctx}
          threadClosed={props.row.closed}
          threadBroom={props.row.opAdmin}
          slug={props.slug}
          threadNum={props.row.number}
          boardPage
        />
      )}
    </Show>
  )
}
