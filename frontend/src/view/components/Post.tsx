import { useLocation } from '@solidjs/router'
import { cva } from 'class-variance-authority'
import { createMemo, createSignal, For, Show } from 'solid-js'
import { postLineCount } from '../../model/content/posts'
import type { Post } from '../../model/entities/post'
import { referenceKey } from '../../model/selectors/forum'
import { resourceKey } from '../../model/state/resources'
import { useForumController, useForumModel, useForumQueries, usePostModel, useStaticInfo } from '../bindings/forum'
import { useComposerBridge } from '../composerBridge'
import { observePostGrowth } from '../effects/postGrowth'
import { useErrors } from '../errors'
import { useI18n } from '../i18n'
import { BroomIcon } from '../icons/BroomIcon'
import { LockIcon } from '../icons/LockIcon'
import { PinIcon } from '../icons/PinIcon'
import { createPostSwipe } from '../interactions/postSwipe'
import { useNav } from '../nav'
import { usePostSelection } from '../postSelection/PostSelectionProvider'
import { ROLE_STYLE } from '../roleStyles'
import { useRoutes } from '../route'
import { useGallery } from './Gallery/useGallery'
import { useIsMobile } from './Gallery/useIsMobile'
import { IncrementalList } from './IncrementalList'
import { PostContent } from './PostContent'
import { PostMedia } from './PostMedia'
import { PostMenu } from './PostMenu'
import { PostRefLink } from './preview/PostRefLink'
import { ReactionPicker } from './ReactionPicker'

export interface PostViewCtx {
  relayUrl: string
  forumId: string
  boardId: string
}

const postVariants = cva('relative px-3 py-2.5 w-fit max-w-post rounded-lg text-fg border-0 mb-2 will-change-transform', {
  variants: {
    variant: {
      default: 'bg-panel1 [--post-bg:var(--color-panel1)]',
      op: 'bg-panel1 w-auto [--post-bg:var(--color-panel1)]',
      mine: 'bg-mine [--post-bg:var(--color-mine)]',
      repliedMine: 'bg-replied-mine [--post-bg:var(--color-replied-mine)]',
    },
    selected: {
      true: 'outline outline-accent -outline-offset-[1.5px] outline-[1.5px]',
    },
    tooltip: {
      true: 'outline outline-glass2 -outline-offset-[1px] outline-[1px]',
    },
  },
  defaultVariants: { variant: 'default' },
})

const postTextVariants = cva('post-text whitespace-pre-wrap break-words', {
  variants: {
    state: {
      collapsed: 'collapsed',
      expanded: 'expanded',
    },
  },
  defaultVariants: { state: 'expanded' },
})

const reactionVariants = cva('inline-flex cursor-pointer items-center justify-center rounded-full border-0 px-2 py-1 gap-1 text-sm text-fg text-bold leading-none hover:bg-hover', {
  variants: {
    active: {
      true: 'bg-reaction',
      false: 'bg-chip',
    },
  },
  defaultVariants: { active: false },
})

export function PostBody(props: {
  post: Post
  ctx: PostViewCtx
  threadClosed: boolean
  threadBroom: boolean
  pinned?: boolean
  slug?: string
  threadNum?: number
  boardPage?: boolean
  tooltip?: boolean
  onEdit?: (id: string) => void
  menu?: boolean
}) {
  const { threadPath } = useRoutes()
  const location = useLocation()
  const linkState = (href: string) => {
    const target = href.split(/[?#]/, 1)[0].replace(/\/+$/, '').toLowerCase()
    const current = decodeURI(location.pathname).replace(/\/+$/, '').toLowerCase()
    return { active: current === target || current.startsWith(`${target}/`), exact: current === target }
  }
  const store = useForumController()
  const model = useForumModel()
  const read = useForumQueries()
  const staticInfo = useStaticInfo()
  const nav = useNav()
  const { t, months, expandFolds } = useI18n()
  const { reportError } = useErrors()
  const { openMedia } = useGallery(() => props.ctx.forumId)
  const selection = usePostSelection()
  const composer = useComposerBridge()
  const mobile = useIsMobile()
  const reactBusy = () => props.post.reactionPending || (model.operations.reacting[resourceKey(props.ctx.forumId, props.post.id)] ?? false)
  const [expanded, setExpanded] = createSignal(false)
  let postEl: HTMLElement | undefined
  const selectable = () => !!selection?.canSelect()
  const selected = () => !!selection?.selected().has(props.post.id)
  observePostGrowth(() => props.post, () => postEl, () => !!props.tooltip)
  const insertNo = () => {
    const quote = composer.takeQuote()
    composer.insert(quote ? `>>${props.post.number}\n${quote}` : `>>${props.post.number}`)
  }
  const swipe = createPostSwipe(() => postEl, () => mobile() && !props.tooltip && !props.boardPage, insertNo)
  const link = (number: number) =>
    props.slug !== undefined && props.threadNum !== undefined
      ? threadPath(props.ctx.forumId, props.slug, props.threadNum, number)
      : undefined
  const gotoPost = (e: MouseEvent, number: number) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
    if (props.slug === undefined || props.threadNum === undefined) return
    e.preventDefault()
    nav.navigate({ page: 'thread', forumId: props.ctx.forumId, slug: props.slug, threadNum: props.threadNum, postNum: number })
  }
  const lineCount = createMemo(() => postLineCount(props.post.parts ?? [], expandFolds()))
  const long = () => lineCount() > 15
  const fullTime = () => {
    if (!props.post.createdAt) return ''
    const d = new Date(props.post.createdAt)
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${pad(d.getDate())} ${months()[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }
  const hasPost = (id: string) => read.containsPost(props.ctx.forumId, props.post.threadId, id)

  const react = async (hex: string) => {
    const rec = props.post
    if (reactBusy()) return
    try {
      await store.reactToPost(rec, props.ctx, hex)
    } catch (e) {
      reportError(e)
    }
  }
  return (
    <article
      id={`post-${props.post.number}`}
      data-post=""
      ref={postEl}
      onTouchStart={swipe.onTouchStart}
      onTouchEnd={swipe.onTouchEnd}
      onTouchCancel={swipe.onTouchCancel}
      class={postVariants({
        variant: props.post.op ? 'op' : props.post.mine ? 'mine' : props.post.repliedMine ? 'repliedMine' : 'default',
        selected: selected(),
        tooltip: !!props.tooltip,
      })}
    >
      <div class={'mb-1.5 flex items-center gap-1.5 text-sm text-secondary'}>
        <Show when={selectable()}>
          <span
            role="checkbox"
            aria-checked={selected()}
            class={'relative flex flex-none cursor-pointer items-center'}
            onClick={(e) => {
              e.stopPropagation()
              selection?.toggle(props.post.id, e.shiftKey)
            }}
          >
            <input type="checkbox" class={'relative size-4 cursor-pointer appearance-none rounded-sm border border-separator bg-panel2 checked:border-accent checked:bg-accent'} checked={selected()} readOnly />
          </span>
        </Show>
        <div class={'flex min-w-0 flex-1 flex-wrap items-center gap-1.5'}>
          <Show when={props.post.role}>
            {(role) => (
              <span class={'whitespace-nowrap'} style={{ color: ROLE_STYLE[role()!].color, 'font-weight': ROLE_STYLE[role()!].bold ? 700 : 400 }}>
                {ROLE_STYLE[role()!].text}
              </span>
            )}
          </Show>
          <span>
            {props.post.name ?? t('post.anon')}
            <Show when={props.post.tripText}>
              {(trip) => (
                <span class={'whitespace-nowrap text-success'}>
                  {props.post.tripSecured ? '!!' : '!'}
                  {trip()}
                </span>
              )}
            </Show>
          </span>
          <Show when={props.post.flagUrl}>{(url) => <img class={'h-3.5 w-auto flex-none rounded-xs'} src={url()} alt="" />}</Show>
          <span class={'whitespace-nowrap'}>{fullTime()}</span>
          <Show when={link(props.post.number)} fallback={<span class={'whitespace-nowrap text-accent'}>№{props.post.number}</span>}>
            {(href) => (
              <Show
                when={props.boardPage}
                fallback={
                  <span class={'whitespace-nowrap text-accent'}>
                    <a class={'post-num bg-transparent p-0 cursor-pointer whitespace-nowrap text-accent [font:inherit]'} href={href()} ref={(element) => { element.setAttribute("noscroll", "true"); element.setAttribute("link", "") }} classList={{ active: linkState(href()).active, inactive: !linkState(href()).active }} aria-current={linkState(href()).exact ? "page" : undefined} onClick={(e) => gotoPost(e, props.post.number)}>
                      №
                    </a>
                    <button type="button" class={'post-num bg-transparent p-0 cursor-pointer whitespace-nowrap text-accent [font:inherit]'} onClick={insertNo}>
                      {props.post.number}
                    </button>
                  </span>
                }
              >
                <a class={'post-num bg-transparent p-0 cursor-pointer whitespace-nowrap text-accent [font:inherit]'} href={href()} ref={(element) => { element.setAttribute("noscroll", "true"); element.setAttribute("link", "") }} classList={{ active: linkState(href()).active, inactive: !linkState(href()).active }} aria-current={linkState(href()).exact ? "page" : undefined} onClick={(e) => gotoPost(e, props.post.number)}>
                  №{props.post.number}
                </a>
              </Show>
            )}
          </Show>
          <Show when={!props.post.hidden && props.post.relNum !== null}>
            <span class={'text-quote'}>{props.post.relNum}</span>
          </Show>
          <Show when={props.post.hidden}>
            <span class={'text-xs font-semibold uppercase tracking-wide text-danger'}>{t('post.deleted')}</span>
          </Show>
          <Show when={props.post.op && props.threadBroom}>
            <BroomIcon width={16} height={16} class={'inline-flex size-4 flex-none align-middle text-[#ff6600]'} />
          </Show>
          <Show when={props.post.op && props.threadClosed}>
            <LockIcon width={16} height={16} class={'inline-flex size-4 flex-none align-middle text-danger'} />
          </Show>
          <Show when={props.pinned}>
            <PinIcon width={16} height={16} class={'inline-flex size-4 flex-none align-middle text-success'} />
          </Show>
        </div>
        <Show when={props.menu !== false}>
          <PostMenu
            post={props.post}
            closed={props.threadClosed}
            threadObject={props.post.op ? (read.threadObject(props.post.threadId) ?? undefined) : undefined}
            onEdit={props.onEdit}
          />
        </Show>
      </div>
      <Show when={props.post.media.length > 0}>
        <PostMedia post={props.post} onOpen={openMedia} />
      </Show>
      <div class={postTextVariants({ state: long() && !expanded() ? 'collapsed' : 'expanded' })}>
        <Show when={props.post.parts} fallback={<span>{props.post.plain}</span>}>
          {(parts) => (
            <PostContent
              parts={parts()}
              author={props.post.author}
              hasPost={hasPost}
              relayUrl={props.ctx.relayUrl}
              forumId={props.ctx.forumId}
              boardId={props.ctx.boardId}
              slug={props.slug}
              threadNum={props.threadNum}
            />
          )}
        </Show>
      </div>
      <Show when={long()}>
        <div class={'mt-2 text-center'}>
          <button type="button" class={'inline-flex cursor-pointer items-center justify-center rounded-full border-0 bg-chip px-2.5 py-1.5 text-sm text-fg'} onClick={() => setExpanded(!expanded())}>
            {expanded() ? t('post.collapse') : t('post.expand', { n: lineCount() })}
          </button>
        </div>
      </Show>
      <Show when={props.post.postcount !== null}>
        <div class={'mt-5 text-secondary italic'}>{t('post.postcount', {
          n: props.post.postcount?.toString() ?? '',
          threads: props.post.threadcount?.toString() ?? '',
        })}</div>
      </Show>
      <Show when={props.post.banned}>
        <div class={'mt-5 text-warn italic'}>{t('post.authorBanned')}</div>
      </Show>
      <Show when={props.post.reactions.length > 0}>
        <div class={'mt-2 flex flex-wrap items-center gap-1.5'}>
          <For each={props.post.reactions}>
            {(item) => (
              <button
                type="button"
                disabled={reactBusy()}
                onClick={() => void react(item.hex)}
                class={reactionVariants({ active: item.hex === props.post.myReaction })}
              >
                <img src={item.url} alt="" class={'size-4'} />
                {item.count}
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={staticInfo()}>
        {(info) => (
          <ReactionPicker
            glyph={props.post.reactionGlyph}
            relayUrl={props.ctx.relayUrl}
            boardId={props.ctx.boardId}
            reactions={info().boardReactions}
            busy={reactBusy()}
            onPick={(hex) => void react(hex)}
          />
        )}
      </Show>
      <Show when={props.post.refs.length > 0}>
        <div class={'mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-secondary'}>
          <IncrementalList each={props.post.refs} revision={props.post.refsRevision} key={(ref) => referenceKey(ref.forumId ?? props.ctx.forumId, ref.postId)}>
            {(ref) => (
              <Show when={ref().board && ref().threadNumber !== undefined ? threadPath(ref().forumId ?? props.ctx.forumId, ref().board!, ref().threadNumber!, ref().number) : link(ref().number)} fallback={<span class={'cursor-pointer text-accent'}>{`>>${ref().number}`}</span>}>
                {(href) => (
                  <PostRefLink
                    class={'cursor-pointer text-accent'}
                    href={href()}
                    label={`>>${ref().number}`}
                    target={{ postId: ref().postId, number: ref().number, forumId: ref().forumId ?? props.ctx.forumId }}
                    onClick={(e) => {
                      if (ref().board && ref().threadNumber !== undefined) {
                        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
                        e.preventDefault()
                        nav.navigate({ page: 'thread', forumId: ref().forumId ?? props.ctx.forumId, slug: ref().board!, threadNum: ref().threadNumber!, postNum: ref().number })
                      } else gotoPost(e, ref().number)
                    }}
                  />
                )}
              </Show>
            )}
          </IncrementalList>
        </div>
      </Show>
    </article>
  )
}

export function Post(props: {
  id: string
  forumId: string
  threadId: string
  threadClosed: boolean
  threadBroom: boolean
  slug?: string
  threadNum?: number
  onEdit?: (id: string) => void
}) {
  const read = useForumQueries()
  const post = usePostModel(props.id)
  return (
    <Show when={post()}>
      {(rec) => (
        <Show when={read.info()}>
          {(info) => (
            <PostBody
              post={rec()}
              ctx={info()}
              threadClosed={props.threadClosed}
              threadBroom={props.threadBroom}
              slug={props.slug}
              threadNum={props.threadNum}
              onEdit={props.onEdit}
            />
          )}
        </Show>
      )}
    </Show>
  )
}
