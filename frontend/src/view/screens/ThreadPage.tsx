import { useLocation } from '@solidjs/router'
import { cva } from 'class-variance-authority'
import { createMemo, Show } from 'solid-js'
import { canBanById, canPostAction } from '../../model/rules/permissions'
import { useForumController, useForumQueries, usePage } from '../bindings/forum'
import { useIsMobile } from '../components/Gallery/useIsMobile'
import { IncrementalList } from '../components/IncrementalList'
import { PageHeader } from '../components/PageHeader'
import { Post } from '../components/Post'
import { PostComposer } from '../components/PostComposer/PostComposer'
import { ThreadNavDown, ThreadNavUp } from '../components/ThreadNav'
import { createThreadScroll } from '../effects/threadScroll'
import { createThreadUnread } from '../effects/unread'
import { useEntityActions } from '../entityActions'
import { useI18n } from '../i18n'
import { useNav } from '../nav'
import { PostSelectionProvider } from '../postSelection/PostSelectionProvider'
import { ThreadSelectionMenu } from '../postSelection/ThreadSelectionMenu'
import { threadModItems } from '../threadModItems'

const pageVariants = cva('flex min-h-screen min-w-0 flex-col')
const screenVariants = cva('flex min-h-dvh flex-col')
const menuTriggerVariants = cva('ml-auto px-1 py-2 hover:bg-hover')
const listVariants = cva('pl-4 pr-3.5')
const listMobileVariants = cva('pl-[calc(1rem+env(safe-area-inset-left,0px))] pr-[calc(1rem+env(safe-area-inset-right,0px))] pb-0 pt-2.5')
const markerVariants = cva('my-3 w-full border-t-2 border-dashed border-accent will-change-transform')

export function ThreadPage(props: { forumId: string; slug: string; threadNum: number }) {
  const { t } = useI18n()
  const controller = useForumController()
  const page = usePage()
  const ea = useEntityActions()
  const canSelect = createMemo(() => canPostAction('delete', ea.roleKinds(), false))
  const threadMenu = () => {
    const current = page()
    if (!current) return []
    const items = threadModItems(t, ea, { threadId: current.id, closed: current.closed, deleted: current.deleted })
    items.push({ label: t('mod.moderators'), onClick: () => ea.openThreadModerators(current.id) })
    items.push({ label: t('mod.bans'), onClick: () => ea.openBans(t('mod.bans'), 'thread', current.id) })
    if (ea.canBanAny() && canBanById(ea.roleKinds())) items.push({ label: t('mod.banId'), onClick: () => ea.openBanId() })
    return items
  }
  return (
    <PostSelectionProvider canSelect={canSelect()}>
      <ThreadBody
        forumId={props.forumId}
        slug={props.slug}
        threadNum={props.threadNum}
        threadMenu={threadMenu}
        onEdit={controller.beginPostEdit}
      />
    </PostSelectionProvider>
  )
}

function ThreadBody(props: {
  forumId: string
  slug: string
  threadNum: number
  threadMenu: () => ReturnType<typeof threadModItems>
  onEdit: (id: string) => void
}) {
  const { t, showDeleted } = useI18n()
  const read = useForumQueries()
  const nav = useNav()
  const mobile = useIsMobile()
  const page = usePage()
  const location = useLocation()
  const posts = () => read.postsOf(showDeleted())
  const list = read.threadPosts
  const heading = () => read.threadTitle() || `#${props.threadNum}`
  const sub = () => (read.threadTitle() ? `/${props.slug}/ - ${t('ui.threadLabel', { n: props.threadNum })}` : `/${props.slug}/`)
  const back = () => nav.back()
  const scroll = createThreadScroll(() => posts().length, read.resyncSeq, () => location.hash)
  const unread = createThreadUnread(() => posts().length, read.resyncSeq, scroll.viewport)
  const marker = {
    get before() {
      const index = unread.markerIndex()
      return index === null ? null : posts()[index] ?? null
    },
    element: <div class={markerVariants()} /> as HTMLDivElement,
  }

  return (
    <section class={mobile() ? screenVariants() : pageVariants()}>
      <PageHeader
        title={heading()}
        subtitle={sub()}
        onBack={back}
        trailing={
          <Show when={page()}>
            <ThreadSelectionMenu items={props.threadMenu()} variant="glass" class={menuTriggerVariants()} />
          </Show>
        }
        below={
          <Show when={!scroll.atTop()}>
            <ThreadNavUp onClick={scroll.up} />
          </Show>
        }
      />
      <div data-thread-scroll="" data-post-column="" class={mobile() ? listMobileVariants() : listVariants()}>
        <IncrementalList
          each={list()?.ids ?? []}
          revision={list()?.revision ?? 0}
          key={(id) => id}
          marker={marker}
        >
          {(id) => (
            <Show when={read.postVisible(id(), showDeleted())}>
              <Post
                id={id()}
                forumId={props.forumId}
                threadId={page()!.id}
                threadClosed={page()!.closed}
                threadBroom={page()!.opAdmin}
                slug={props.slug}
                threadNum={props.threadNum}
                onEdit={props.onEdit}
              />
            </Show>
          )}
        </IncrementalList>
      </div>
      <PostComposer
        mode="reply"
        slug={props.slug}
        nav={
          <Show when={!scroll.atEnd()}>
            <ThreadNavDown unread={unread.unreadCount()} onClick={scroll.down} />
          </Show>
        }
      />
    </section>
  )
}
