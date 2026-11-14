import type { Failure } from '../errors'
export type SettingSlug = 'key' | 'appearance'
export type SettingKey = 'Master Key' | 'Appearance'


export type ModTab = 'overboard' | 'reports' | 'actions' | 'gallery'

export const MOD_TAB_SLUGS: readonly ModTab[] = ['overboard', 'reports', 'actions', 'gallery']

export type Route =
  | { page: 'boards'; forumId?: string }
  | { page: 'board'; forumId: string; slug: string }
  | { page: 'thread'; forumId: string; slug: string; threadNum: number; replyTo?: number; scrollTo?: 'top' | 'bottom'; postNum?: number }
  | { page: 'compose'; forumId: string; slug: string }
  | { page: 'settings'; setting?: SettingSlug }
  | { page: 'mod'; tab: ModTab }


export interface ForumInfo {
  forumId: string
  relayUrl: string
  host: string
}

export interface BoardInfo {
  slug: string
  id: string
  title: string
  count: number
}

export interface NavigationState {
  defaultForumId: string | null
  route: Route | null
  lastContentRoute: Route | null
  context: { forumId: string; relayUrl: string } | null
  forums: ForumInfo[]
  loading: boolean
  refreshing: boolean
  reconnecting: boolean
  error: Failure | null
  collapsed: boolean
}
