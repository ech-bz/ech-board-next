import { Router, Route as RouterRoute, useLocation } from '@solidjs/router'
import { cva } from 'class-variance-authority'
import { createEffect, createMemo, createSignal, on, Show } from 'solid-js'
import type { ForumRuntime } from '../controller/createController'
import { hasModRole } from '../model/rules/permissions'
import type { RoleKind } from '../model/rules/roles'
import type { ForumInfo } from '../model/state/navigation'
import { ForumProvider, useForumController, useForumModel, useForumQueries } from './bindings/forum'
import { GalleryProvider } from './components/Gallery/GalleryProvider'
import { NavPanel, type Section } from './components/NavPanel'
import { PostTooltipProvider } from './components/preview/PostTooltipProvider'
import { StateScreen } from './components/StateScreen'
import { StatusPill } from './components/StatusPill'
import { ComposerBridgeProvider } from './composerBridge'
import { createHeldPageHeight } from './effects/heldPageHeight'
import { EntityActionsProvider } from './entityActions'
import { errorMessage } from './errors'
import { I18nLocaleScope, I18nProvider } from './i18n'
import { IconSprite } from './icons/IconSprite'
import { ModGalleryProvider } from './components/mod/ModGallery'
import { ModalsProvider } from './modals'
import { closeModTabs } from './modTabs'
import { modPreviewEnabled } from './modPreview'
import { NavProvider, useNav } from './nav'
import { parseRoute } from './route'
import { BoardPage } from './screens/BoardPage'
import { BoardsPage } from './screens/BoardsPage'
import { ComposePage } from './screens/ComposePage'
import { ModPage } from './screens/ModPage'
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

function Shell() {
  const store = useForumController()
  const read = useForumQueries()
  const model = useForumModel()
  const location = useLocation()
  const nav = useNav()
  const context = () => model.navigation.context
  const roles = read.roles
  const boards = read.boards
  const forums = () => model.navigation.forums
  const collapsed = () => model.navigation.collapsed
  const loading = () => model.navigation.loading
  const error = () => model.navigation.error
  const reconnecting = () => model.navigation.reconnecting
  const refreshing = () => model.navigation.refreshing

  createEffect(() => {
    const current = parseRoute(location.pathname + location.hash, model.navigation.defaultForumId)
    void store.navigate(current).then((redirect) => { if (redirect) nav.navigate(redirect) })
  })
  createEffect(() => {
    for (const item of model.notifications) {
      store.dismissNotification(item.id)
      window.alert(errorMessage(item.message, model.preferences.lang))
    }
  })

  const [modSeenForum, setModSeenForum] = createSignal<string | null>(null)
  createEffect(() => {
    const ctx = context()
    if (ctx && hasModRole(roles().map((role) => role.kind))) setModSeenForum(ctx.forumId)
  })
  const modRoleKinds = createMemo((): RoleKind[] => (modSeenForum() === context()?.forumId ? [...new Set(roles().map((role) => role.kind))] : []))
  const isMod = () => modPreviewEnabled() || hasModRole(modRoleKinds()) || (modSeenForum() !== null && modSeenForum() === context()?.forumId)
  const previewRoleKinds = (): RoleKind[] => (modRoleKinds().length > 0 ? modRoleKinds() : modPreviewEnabled() ? ['forum_mod'] : [])

  const route = () => parseRoute(location.pathname + location.hash, model.navigation.defaultForumId)
  createEffect(on(() => route().page, (page) => page !== 'mod' && closeModTabs(), { defer: true }))
  const modRoute = createMemo(() => {
    const current = route()
    return current.page === 'mod' ? current : null
  })
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
  const currentForum = () => forums().find((forum) => forum.forumId === context()?.forumId) ?? null
  const selectForum = (forum: ForumInfo) => {
    nav.navigate({ page: 'boards', forumId: forum.forumId })
  }
  const goSection = (next: Section) => nav.section(next)
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
      forums={forums()}
      forum={currentForum()}
      boards={boards()}
      board={currentBoard()}
      setting={setting()}
      modTab={modRoute()?.tab ?? null}
      onOpenMod={(tab) => nav.navigate({ page: 'mod', tab })}
      onToggleCollapsed={store.toggleSidebar}
      onSelectForum={selectForum}
      onSelectBoard={(board) => nav.navigate({ page: 'board', forumId: context()!.forumId, slug: board.slug })}
      onOpenSetting={(slug) => nav.navigate({ page: 'settings', setting: slug })}
      settingsHref="/settings"
      onNavigateSection={goSection}
    />
  )

  return (
    <I18nProvider>
      <I18nLocaleScope lang="en" active={() => modRoute() !== null}>
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
                      when={context() && !loading()}
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
                              host={currentForum()?.host}
                            />
                          )}
                        </Show>
                        <Show when={composeRoute()}>
                          {(r) => <ComposePage forumId={r().forumId ?? ''} slug={r().slug} heading={boardHeading()} />}
                        </Show>
                        <Show when={route().page === 'boards' ? true : null}>
                          <BoardsPage
                            forumId={context()!.forumId}
                            boards={boards()}
                            forums={forums()}
                            onSelectForum={selectForum}
                          />
                        </Show>
                        <Show when={modRoute()}>
                          {(r) => (
                            <ModGalleryProvider>
                              <ModPage
                                tab={r().tab}
                                forumId={context()!.forumId}
                                boards={boards().map((board) => board.slug)}
                                ready={boards().length > 0}
                                canModerate={isMod()}
                                roleKinds={previewRoleKinds()}
                              />
                            </ModGalleryProvider>
                          )}
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
      </I18nLocaleScope>
    </I18nProvider>
  )
}

export default function App(props: { runtime: ForumRuntime }) {
  return (
    <ForumProvider runtime={props.runtime}>
      <Router>
        <RouterRoute path="*" component={() => (
          <NavProvider>
            <Shell />
          </NavProvider>
        )}
        />
      </Router>
    </ForumProvider>
  )
}
