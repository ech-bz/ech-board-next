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

const listVariants = cva('flex flex-col px-2')
const relayVariants = cva('flex flex-col')
const relayHeaderVariants = cva('flex items-center gap-0.5 rounded-md hover:bg-hover')
const relayToggleVariants = cva('flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-2 text-left')
const logoVariants = cva('inline-flex h-logo shrink-0 items-center')
const hostVariants = cva('min-w-0 flex-1 ellipsis font-semibold text-fg')
const boardsVariants = cva('flex flex-col pb-1 pl-3')
const boardVariants = cva('grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-1.5 rounded-md px-2 py-1.5 no-underline hover:bg-hover', {
  variants: {
    active: {
      true: 'bg-active',
    },
  },
})
const boardSlugVariants = cva('font-semibold text-accent')
const boardTitleVariants = cva('min-w-0 ellipsis text-sm text-fg')
const boardCountVariants = cva('text-xs text-secondary')
const emptyVariants = cva('px-2 py-1.5 text-sm text-secondary')
const errorVariants = cva('mx-2 mb-1 flex items-center gap-2 rounded-md bg-panel2 px-2 py-1.5 text-xs text-warn')
const errorTextVariants = cva('min-w-0 flex-1 ellipsis')
const retryVariants = cva('shrink-0 cursor-pointer font-semibold text-accent')
const addRowVariants = cva('mt-2 flex items-center gap-2 pr-1')
const compactListVariants = cva('flex flex-col items-center px-1')

export function RelayList(props: { compact?: boolean }) {
  const model = useForumModel()
  const read = useForumQueries()
  const controller = useForumController()
  const ea = useEntityActions()
  const nav = useNav()
  const { t } = useI18n()
  const { reportError, errorMessage } = useErrors()
  const { boardPath } = useRoutes()
  const [relayInput, setRelayInput] = createSignal('')
  const [collapsed, setCollapsed] = createSignal<string[]>([])
  const isCollapsed = (forumId: string) => collapsed().includes(forumId)
  const contextForumId = () => model.navigation.context?.forumId ?? null
  const toggle = (forumId: string) => setCollapsed((prev) => prev.includes(forumId) ? prev.filter((id) => id !== forumId) : [...prev, forumId])
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
    return items
  }
  const open = (forumId: string, board: BoardInfo) => {
    nav.navigate({ page: 'board', forumId, slug: board.slug })
  }
  return (
    <Show
      when={!props.compact}
      fallback={(
        <div class={compactListVariants()}>
          <For each={read.boards()}>
            {(board) => (
              <a
                class="grid w-full cursor-pointer grid-cols-[44px_1fr] items-center rounded-md px-1 py-2.5 no-underline hover:bg-hover"
                title={board.title}
                href={boardPath(contextForumId() ?? '', board.slug)}
                onClick={(e) => {
                  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
                  const forumId = contextForumId()
                  if (!forumId) return
                  e.preventDefault()
                  open(forumId, board)
                }}
              >
                <div class="font-bold text-accent collapsed:whitespace-nowrap">/{board.slug}/</div>
              </a>
            )}
          </For>
        </div>
      )}
    >
      <div class={listVariants()}>
        <For each={model.navigation.forums}>
          {(forum) => {
            const error = () => model.navigation.forumErrors[forum.forumId] ?? null
            const boards = () => read.boardsOf(forum.forumId)
            return (
              <div class={relayVariants()}>
                <div class={relayHeaderVariants()}>
                  <button type="button" class={relayToggleVariants()} onClick={() => toggle(forum.forumId)}>
                    <span class={logoVariants()}>
                      <img class="h-full w-auto" src="/static/logo.svg" alt="" />
                    </span>
                    <span class={hostVariants()}>{host(forum)}</span>
                  </button>
                  <DropdownMenu items={relayMenu(forum)} triggerSize="sm" triggerShape="circle" triggerVariant="glass" class="shrink-0 mr-1" />
                </div>
                <Show when={error()}>
                  {(message) => (
                    <div class={errorVariants()}>
                      <span class={errorTextVariants()}>{errorMessage(message())}</span>
                      <button type="button" class={retryVariants()} onClick={() => { void controller.retryForum(forum.forumId) }}>
                        {t('forum.retry')}
                      </button>
                    </div>
                  )}
                </Show>
                <Show when={!isCollapsed(forum.forumId)}>
                  <div class={boardsVariants()}>
                    <Show when={!error()}>
                      <Show when={read.forumObjectOf(forum.forumId)} fallback={<div class={emptyVariants()}>{t('ui.loading')}</div>}>
                        <Show when={boards().length > 0} fallback={<div class={emptyVariants()}>{t('forum.noBoards')}</div>}>
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
        <div class={addRowVariants()}>
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
