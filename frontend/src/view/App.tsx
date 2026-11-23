import { Router, Route as RouterRoute, useLocation } from '@solidjs/router'
import { cva } from 'class-variance-authority'
import { createEffect, createMemo, Show } from 'solid-js'
import type { ForumRuntime } from '../controller/createController'
import { forumKey } from '../model/selectors/forum'
import { ForumProvider, useForumController, useForumModel, useForumQueries } from './bindings/forum'
import { GalleryProvider } from './components/Gallery/GalleryProvider'
import { useIsMobile } from './components/Gallery/useIsMobile'
import { NavPanel, type Section } from './components/NavPanel'
import { PostTooltipProvider } from './components/preview/PostTooltipProvider'
import { StateScreen } from './components/StateScreen'
import { StatusPill } from './components/StatusPill'
import { ComposerBridgeProvider } from './composerBridge'
import { createHeldPageHeight } from './effects/heldPageHeight'
import { EntityActionsProvider } from './entityActions'
import { errorMessage } from './errors'
import { I18nProvider, useI18n } from './i18n'
import { IconSprite } from './icons/IconSprite'
import { ModalsProvider } from './modals'
import { NavProvider, useNav } from './nav'
import { parseRoute } from './route'
import { BoardPage } from './screens/BoardPage'
import { BoardsScreen } from './screens/BoardsScreen'
import { ComposePage } from './screens/ComposePage'
import { SettingsPage } from './screens/SettingsPage'
import { ThreadPage } from './screens/ThreadPage'
import { TitleSync } from './TitleSync'

const rootVariants = cva('min-h-dvh')
const asideVariants = cva('max-[899px]:hidden fixed left-0 top-0 bottom-0 z-nav flex flex-col border-r border-separator bg-panel1', {
  variants: {
    collapsed: {
      true: 'collapsed w-nav-collapsed',
      false: 'w-nav',
    },
  },
})
const mainVariants = cva('min-h-dvh min-w-0 max-[899px]:ml-0', {
  variants: {
    offset: {
      nav: 'ml-nav',
      collapsed: 'ml-nav-collapsed',
    },
  },
  defaultVariants: { offset: 'nav' },
})
const placeholderVariants = cva('flex min-h-dvh items-center justify-center p-8 text-secondary')

function Shell() {
  const store = useForumController()
  const read = useForumQueries()
  const model = useForumModel()
  const location = useLocation()
  const nav = useNav()
  const { t } = useI18n()
  const mobile = useIsMobile()
  const context = () => model.navigation.context
  const roles = read.roles
  const boards = read.boards
  const collapsed = () => model.navigation.collapsed
  const loading = () => model.navigation.loading
  const error = () => model.navigation.error
  const reconnecting = () => model.navigation.reconnecting
  const refreshing = () => model.navigation.refreshing

  createEffect(() => {
    const current = parseRoute(location.pathname + location.hash, model.navigation.defaultForumId)
    void store.navigate(current).then((redirect) => { if (redirect) nav.navigate(redirect) })
    if (current.page === 'boards' && location.pathname !== '/') nav.home()
  })
  createEffect(() => {
    for (const item of model.notifications) {
      store.dismissNotification(item.id)
      window.alert(errorMessage(item.message, model.preferences.lang))
    }
  })

  const route = () => parseRoute(location.pathname + location.hash, model.navigation.defaultForumId)
  const threadRoute = createMemo(() => {
    const current = route()
    return current.page === 'thread' ? current : null
  })
  const boardRoute = createMemo(() => {
    const current = route()
    return current.page === 'board' ? current : null
  })
  const composeRoute = createMemo(() => {
    const current = route()
    return current.page === 'compose' ? current : null
  })
  const section = (): Section => (route().page === 'settings' ? 'settings' : 'boards')
  const setting = () => {
    const current = route()
    return current.page === 'settings' ? (current.setting ?? null) : null
  }
  const currentBoard = () => {
    const current = route()
    if (current.page === 'board' || current.page === 'thread' || current.page === 'compose') {
      return boards().find((board) => board.slug === current.slug) ?? null
    }
    return null
  }
  const goSection = (next: Section) => nav.section(next)
  const forumHost = (forumId: string) => {
    const forum = model.navigation.forums.find((item) => forumKey(item.forumId) === forumKey(forumId))
    return forum ? new URL(forum.relayUrl).host : undefined
  }
  const boardHeading = () => {
    const board = currentBoard()
    if (!board) return ''
    return board.title ? `/${board.slug}/ - ${board.title}` : `/${board.slug}/`
  }

  const held = createHeldPageHeight(() => loading() || refreshing(), () => !!error())

  const panel = () => (
    <NavPanel
      collapsed={collapsed()}
      section={section()}
      setting={setting()}
      onToggleCollapsed={store.toggleSidebar}
      onOpenSetting={(slug) => nav.navigate({ page: 'settings', setting: slug })}
      settingsHref="/settings"
      onNavigateSection={goSection}
    />
  )

  return (
    <ModalsProvider roles={roles()} relayUrl={context()?.relayUrl ?? ''}>
        <EntityActionsProvider roles={roles()}>
          <ComposerBridgeProvider>
            <GalleryProvider>
              <PostTooltipProvider boardPage={boardRoute() != null}>
                <div class={rootVariants()}>
                  <IconSprite />
                  <TitleSync boards={boards()} />
                  <aside class={asideVariants({ collapsed: collapsed() })}>{panel()}</aside>
                  <main ref={held.ref} class={mainVariants({ offset: collapsed() ? 'collapsed' : 'nav' })} style={{ 'min-height': loading() || refreshing() ? `${held.height()}px` : '' }}>
                    <Show
                      when={!loading()}
                      fallback={<StateScreen error={error()} />}
                    >
                      <Show when={!error()} fallback={<StateScreen error={error()} />}>
                        <Show when={threadRoute()}>
                          {(r) => <ThreadPage forumId={r().forumId ?? ''} slug={r().slug} threadNum={r().threadNum} />}
                        </Show>
                        <Show when={boardRoute()}>
                          {(r) => (
                            <BoardPage
                              forumId={r().forumId ?? ''}
                              slug={r().slug}
                              heading={boardHeading()}
                              host={forumHost(r().forumId)}
                            />
                          )}
                        </Show>
                        <Show when={composeRoute()}>
                          {(r) => <ComposePage forumId={r().forumId ?? ''} slug={r().slug} heading={boardHeading()} />}
                        </Show>
                        <Show when={route().page === 'boards' ? true : null}>
                          <Show when={!mobile()} fallback={<BoardsScreen />}>
                            <div class={placeholderVariants()}>{t('ui.boardSelectText')}</div>
                          </Show>
                        </Show>
                        <Show when={route().page === 'settings' ? true : null}>
                          <SettingsPage setting={setting()} baseHref="/settings" />
                        </Show>
                      </Show>
                    </Show>
                  </main>
                  <StatusPill reconnecting={reconnecting()} refreshing={refreshing()} />
                </div>
              </PostTooltipProvider>
            </GalleryProvider>
          </ComposerBridgeProvider>
        </EntityActionsProvider>
      </ModalsProvider>
  )
}

export default function App(props: { runtime: ForumRuntime }) {
  return (
    <ForumProvider runtime={props.runtime}>
      <Router>
        <RouterRoute path="*" component={() => (
          <NavProvider>
            <I18nProvider>
              <Shell />
            </I18nProvider>
          </NavProvider>
        )}
        />
      </Router>
    </ForumProvider>
  )
}
