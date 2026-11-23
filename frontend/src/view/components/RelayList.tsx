import { cva } from 'class-variance-authority'
import { createSignal, For, Show } from 'solid-js'
import { roleForForumSettings } from '../../model/rules/permissions'
import { forumKey } from '../../model/selectors/forum'
import type { BoardInfo, ForumInfo } from '../../model/state/navigation'
import { useForumController, useForumModel, useForumQueries } from '../bindings/forum'
import { useEntityActions } from '../entityActions'
import { useErrors } from '../errors'
import { useI18n } from '../i18n'
import { PlusIcon } from '../icons/PlusIcon'
import { useNav } from '../nav'
import { useRoutes } from '../route'
import { Field } from './Field'
import { IconButton } from './IconButton'
import { DropdownMenu, type MenuItem } from './Menu/DropdownMenu'

const listVariants = cva('flex flex-col', {
  variants: {
    mobile: { true: 'gap-2.5', false: 'px-2' },
  },
  defaultVariants: { mobile: false },
})
const relayVariants = cva('flex flex-col', {
  variants: {
    mobile: { true: 'overflow-hidden rounded-lg bg-panel1', false: '' },
  },
  defaultVariants: { mobile: false },
})
const relayToggleVariants = cva('flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left', {
  variants: {
    mobile: { true: '', false: '' },
  },
  defaultVariants: { mobile: false },
})
const logoVariants = cva('inline-flex h-logo shrink-0 items-center')
const hostVariants = cva('min-w-0 flex-1 ellipsis font-semibold text-fg text-lg')
const boardVariants = cva('grid cursor-pointer grid-cols-[44px_1fr_auto] items-center gap-1.5 rounded-md px-2 py-2.5 no-underline hover:bg-hover', {
  variants: {
    active: {
      true: 'bg-active',
    },
  },
})
const boardSlugVariants = cva('font-bold text-accent')
const boardTitleVariants = cva('font-semibold text-fg')
const boardCountVariants = cva('text-sm text-secondary')
const emptyVariants = cva('text-sm text-secondary', {
  variants: {
    mobile: { true: 'px-4 py-3', false: 'px-2 py-1.5' },
  },
  defaultVariants: { mobile: false },
})
const errorVariants = cva('flex items-center gap-2 bg-panel2 text-warn', {
  variants: {
    mobile: { true: 'border-t border-separator px-4 py-2.5 text-sm', false: 'mx-2 mb-1 rounded-md px-2 py-1.5 text-xs' },
  },
  defaultVariants: { mobile: false },
})
const errorTextVariants = cva('min-w-0 flex-1 ellipsis')
const retryVariants = cva('shrink-0 cursor-pointer font-semibold text-accent')
const addRowVariants = cva('flex items-center gap-2', {
  variants: {
    mobile: { true: 'rounded-lg bg-panel1 p-2', false: 'mt-2' },
  },
  defaultVariants: { mobile: false },
})
const compactListVariants = cva('flex flex-col items-center px-1')
const compactSeparatorVariants = cva('my-1 h-px w-full shrink-0 bg-separator')

export function RelayList(props: { compact?: boolean; mobile?: boolean }) {
  const model = useForumModel()
  const read = useForumQueries()
  const controller = useForumController()
  const ea = useEntityActions()
  const nav = useNav()
  const { t } = useI18n()
  const { reportError, errorMessage } = useErrors()
  const { boardPath } = useRoutes()
  const [relayInput, setRelayInput] = createSignal('')
  const isCollapsed = (forumId: string) => model.navigation.collapsedForums.includes(forumKey(forumId))
  const toggle = (forumId: string) => controller.toggleForum(forumId)
  const host = (forum: ForumInfo) => new URL(forum.relayUrl).host
  const addRelay = () => {
    const value = relayInput().trim()
    if (!value) return
    setRelayInput('')
    void controller.addRelay(value)
  }
  const activeBoard = (forumId: string, board: BoardInfo) => {
    const route = model.navigation.route
    return !!route && 'slug' in route && route.slug === board.slug && forumKey(route.forumId) === forumKey(forumId)
  }
  const relayMenu = (forum: ForumInfo): MenuItem[] => {
    const forumObject = read.forumObjectOf(forum.forumId)
    const items: MenuItem[] = [
      { label: t('forum.copyEsid'), onClick: () => { void controller.copyForumEsid(forum.forumId).catch(reportError) } },
    ]
    if (forumObject && roleForForumSettings(forumObject.roles)) items.push(
      { label: t('forum.editTitle'), onClick: () => controller.openForumTitle(forum.forumId) },
      { label: t('forum.createBoard'), onClick: () => controller.openCreateBoard(forum.forumId) },
    )
    items.push(
      { label: t('mod.debug'), onClick: () => ea.openLogs('forum', undefined, forum.relayUrl) },
      { label: t('tx.title'), onClick: () => ea.openTransaction('', forum.relayUrl) },
      {
        label: t('mod.bans'),
        onClick: () => {
          if (forumObject) ea.openBans(t('mod.bans'), 'forum', forumObject.id, forum.relayUrl)
        },
      },
      { label: t('mod.moderators'), onClick: () => ea.openForumModerators(forum.forumId) },
    )
    if (forumKey(forum.forumId) !== model.navigation.defaultForumId) items.push({ label: t('forum.removeRelay'), danger: true, onClick: () => remove(forum) })
    return items
  }
  const remove = (forum: ForumInfo) => {
    const key = forumKey(forum.forumId)
    const route = model.navigation.route
    controller.removeRelay(forum.forumId)
    if (route && 'forumId' in route && forumKey(route.forumId) === key) nav.home()
  }
  const open = (forumId: string, board: BoardInfo) => {
    nav.navigate({ page: 'board', forumId, slug: board.slug })
  }
  return (
    <Show
      when={!props.compact}
      fallback={(
        <div class={compactListVariants()}>
          <For each={model.navigation.forums}>
            {(forum, index) => (
              <>
                <Show when={index() > 0}>
                  <div class={compactSeparatorVariants()} />
                </Show>
                <For each={read.boardsOf(forum.forumId)}>
                  {(board) => (
                    <a
                      class="grid w-full cursor-pointer grid-cols-[44px_1fr] items-center rounded-md px-1 py-2.5 no-underline hover:bg-hover"
                      title={`${host(forum)}/${board.slug}/`}
                      href={boardPath(forum.forumId, board.slug)}
                      onClick={(e) => {
                        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
                        e.preventDefault()
                        open(forum.forumId, board)
                      }}
                    >
                      <div class="font-bold text-accent collapsed:whitespace-nowrap">/{board.slug}/</div>
                    </a>
                  )}
                </For>
              </>
            )}
          </For>
        </div>
      )}
    >
      <div class={listVariants({ mobile: props.mobile })}>
        <For each={model.navigation.forums}>
          {(forum) => {
            const error = () => model.navigation.forumErrors[forum.forumId] ?? null
            const boards = () => read.boardsOf(forum.forumId)
            return (
              <div class={relayVariants({ mobile: props.mobile })}>
                <div class='flex items-center gap-0.5 rounded-md hover:bg-hover px-2 py-2'>
                  <button type="button" class={relayToggleVariants({ mobile: props.mobile })} onClick={() => toggle(forum.forumId)}>
                    <span class={logoVariants()}>
                      <img class="h-full w-auto" src="/static/logo.svg" alt="" />
                    </span>
                    <span class={hostVariants()}>{host(forum)}</span>
                  </button>
                  <DropdownMenu items={relayMenu(forum)} triggerSize={props.mobile ? 'md' : 'sm'} triggerShape="circle" class='shrink-0' />
                </div>
                <Show when={!isCollapsed(forum.forumId)}>
                  <div class={compactSeparatorVariants()} />
                </Show>
                <Show when={error()}>
                  {(message) => (
                    <div class={errorVariants({ mobile: props.mobile })}>
                      <span class={errorTextVariants()}>{errorMessage(message())}</span>
                      <button type="button" class={retryVariants()} onClick={() => { void controller.retryForum(forum.forumId) }}>
                        {t('forum.retry')}
                      </button>
                    </div>
                  )}
                </Show>
                <Show when={!isCollapsed(forum.forumId)}>
                  <div class='flex flex-col px-1 py-1'>
                    <Show when={!error()}>
                      <Show when={read.forumObjectOf(forum.forumId)} fallback={<div class={emptyVariants({ mobile: props.mobile })}>{t('ui.loading')}</div>}>
                        <Show when={boards().length > 0} fallback={<div class={emptyVariants({ mobile: props.mobile })}>{t('forum.noBoards')}</div>}>
                          <For each={boards()}>
                            {(board) => (
                              <a
                                class={boardVariants({ active: activeBoard(forum.forumId, board) })}
                                title={board.title}
                                href={boardPath(forum.forumId, board.slug)}
                                onClick={(e) => {
                                  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
                                  e.preventDefault()
                                  open(forum.forumId, board)
                                }}
                              >
                                <div class={boardSlugVariants()}>/{board.slug}/</div>
                                <div class={boardTitleVariants()}>{board.title}</div>
                                <div class={boardCountVariants()}>{board.count.toLocaleString()}</div>
                              </a>
                            )}
                          </For>
                        </Show>
                      </Show>
                    </Show>
                  </div>
                </Show>
              </div>
            )
          }}
        </For>
        <div class={addRowVariants({ mobile: props.mobile })}>
          <Field
            as="input"
            grow="min-w-0"
            value={relayInput()}
            placeholder={t('forum.relayPlaceholder')}
            onInput={(e) => setRelayInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addRelay()
            }}
          />
          <IconButton size="md" shape="rounded" variant="glass" aria-label={t('forum.addRelay')} onClick={addRelay}>
            <PlusIcon width={16} height={16} />
          </IconButton>
        </div>
      </div>
    </Show>
  )
}
