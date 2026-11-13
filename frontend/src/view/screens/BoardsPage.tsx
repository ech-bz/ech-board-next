import { A } from '@solidjs/router'
import { cva } from 'class-variance-authority'
import { For, Show } from 'solid-js'
import { roleForForumSettings } from '../../model/rules/permissions'
import type { BoardInfo, ForumInfo } from '../../model/state/navigation'
import { useForumController, useForumQueries } from '../bindings/forum'
import { ForumPage } from '../components/ForumPage'
import { useIsMobile } from '../components/Gallery/useIsMobile'
import { DropdownMenu, type MenuItem } from '../components/Menu/DropdownMenu'
import { PageHeader } from '../components/PageHeader'
import { TabBar } from '../components/TabBar'
import { useEntityActions } from '../entityActions'
import { useErrors } from '../errors'
import { useI18n } from '../i18n'
import { ChevronRightIcon } from '../icons/ChevronRightIcon'
import { useMobileTabs } from '../interactions/mobileNav'
import { useRoutes } from '../route'

const pageVariants = cva('flex min-h-screen min-w-0 flex-col')
const screenVariants = cva('flex min-h-dvh flex-col')
const chipsRowVariants = cva('flex items-center gap-2 overflow-x-auto px-4 pb-2.5 pt-0.5 [scrollbar-width:none]')
const chipVariants = cva('flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-2 text-sm', {
  variants: {
    active: {
      true: 'bg-accent text-[#101d29]',
      false: 'bg-panel2 text-secondary',
    },
  },
  defaultVariants: { active: false },
})
const chipLogoVariants = cva('inline-flex h-logo-mobile items-center')
const contentPadVariants = cva('pl-[calc(1rem+env(safe-area-inset-left,0px))] pr-[calc(1rem+env(safe-area-inset-right,0px))] pb-[calc(var(--mobile-tab)+18px)] pt-2.5')
const listVariants = cva('overflow-hidden rounded-lg bg-panel1')
const rowVariants = cva('mx-4 grid min-h-row cursor-pointer grid-cols-[64px_1fr_auto_auto] items-center gap-2 border-b border-separator py-2.5 text-fg last:border-b-0 no-underline')
const slugVariants = cva('text-xl font-semibold text-accent leading-none')
const nameVariants = cva('text-xl text-fg leading-none')
const countVariants = cva('text-sm text-secondary leading-none')
const chevronVariants = cva('text-3xl text-secondary leading-none')

export function BoardsPage(props: {
  forumId: string
  boards: BoardInfo[]
  forums: ForumInfo[]
  onSelectForum: (forum: ForumInfo) => void
}) {
  const { boardPath } = useRoutes()
  const { t } = useI18n()
  const { reportError } = useErrors()
  const ea = useEntityActions()
  const controller = useForumController()
  const read = useForumQueries()
  const mobile = useIsMobile()
  const tabs = useMobileTabs()
  const forumMenu = (): MenuItem[] => {
    const items: MenuItem[] = [
      { label: t('forum.copyEsid'), onClick: () => { void controller.copyForumEsid(props.forumId).catch(reportError) } },
    ]
    if (roleForForumSettings(read.roles())) items.push(
      { label: t('forum.editTitle'), onClick: controller.openForumTitle },
      { label: t('forum.createBoard'), onClick: controller.openCreateBoard },
    )
    items.push(
      { label: t('mod.debug'), onClick: () => ea.openLogs('forum') },
      { label: t('mod.bans'), onClick: () => {
        const forum = read.forumObject()
        if (forum) ea.openBans(t('mod.bans'), 'forum', forum.id)
      } },
      { label: t('mod.moderators'), onClick: () => ea.openForumModerators() },
    )
    return items
  }
  const totalPosts = () => props.boards.reduce((sum, board) => sum + board.count, 0)
  const host = () => props.forums.find((forum) => forum.forumId === props.forumId)?.host ?? ''
  const forumPage = () => <ForumPage boardsCount={props.boards.length} totalPosts={totalPosts()} />
  return (
    <section class={mobile() ? screenVariants() : pageVariants()}>
      <PageHeader
        title={read.forumObject()?.title || t('forum.untitled')}
        subtitle={host()}
        trailing={<DropdownMenu items={forumMenu()} triggerVariant="glass" class="px-1 py-2 hover:bg-hover" />}
      />
      <Show when={mobile()} fallback={forumPage()}>
        <div class={chipsRowVariants()}>
          <For each={props.forums}>
            {(forum) => (
              <button
                type="button"
                class={chipVariants({ active: forum.forumId === props.forumId })}
                onClick={() => props.onSelectForum(forum)}
              >
                <span class={chipLogoVariants()}>
                  <img class="h-full w-auto" src="/static/logo.svg" alt="" />
                </span>
                {forum.host}
              </button>
            )}
          </For>
        </div>
        <div class={contentPadVariants()}>
          {forumPage()}
          <div class={listVariants()}>
            <For each={props.boards}>
              {(board) => (
                <A class={rowVariants()} href={boardPath(props.forumId, board.slug)}>
                  <div class={slugVariants()}>/{board.slug}/</div>
                  <div class={nameVariants()}>{board.title}</div>
                  <div class={countVariants()}>{board.count.toLocaleString()}</div>
                  <div class={chevronVariants()}>
                    <ChevronRightIcon width={24} height={24} />
                  </div>
                </A>
              )}
            </For>
          </div>
        </div>
        <TabBar boardsActive settingsActive={false} onGoHome={tabs.goHome} onOpenSettings={tabs.openSettings} />
      </Show>
    </section>
  )
}
