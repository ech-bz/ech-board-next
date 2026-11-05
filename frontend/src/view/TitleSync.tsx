import { unreadCount } from '../model/state/unread'
import { useLocation } from '@solidjs/router'
import { createEffect, createMemo } from 'solid-js'
import type { BoardInfo } from '../model/state/navigation'
import { useForumModel, useForumQueries, usePage } from './bindings/forum'
import { useI18n } from './i18n'
import { parseRoute } from './route'

export function TitleSync(props: { boards: BoardInfo[] }) {
  const { t } = useI18n()
  const read = useForumQueries()
  const page = usePage()
  const model = useForumModel()
  const location = useLocation()
  const title = createMemo(() => {
    const route = parseRoute(location.pathname + location.hash, model.navigation.defaultForumId)
    const forumName = read.forumObject()?.title || t('forum.untitled')
    if (route.page === 'board') {
      const board = props.boards.find((item) => item.slug === route.slug)
      return board ? `/${route.slug}/ - ${board.title}` : `/${route.slug}/`
    }
    if (route.page === 'thread') {
      const current = page()
      const title = current ? read.threadTitle() : ''
      return `/${route.slug}/ - ${title || `#${route.threadNum}`}`
    }
    if (route.page === 'compose') {
      return `/${route.slug}/ - ${t('ui.newThread')}`
    }
    if (route.page === 'settings') {
      return `${forumName} - ${t('ui.settings')}`
    }
    return forumName
  })
  createEffect(() => {
    document.title = unreadCount(model.unread) > 0 ? `(${unreadCount(model.unread)}) ${title()}` : title()
  })
  createEffect(() => {
    const theme = model.preferences.theme
    const suffix = unreadCount(model.unread) > 0 ? '_unread' : ''
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.href = `/favicon_${theme}${suffix}.png`
  })
  return null
}
