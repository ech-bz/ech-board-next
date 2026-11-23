import type { Failure } from '../errors'
export type SettingSlug = 'account' | 'appearance'
export type SettingKey = 'Account' | 'Appearance'


export type Route =
  | { page: 'boards' }
  | { page: 'board'; forumId: string; slug: string }
  | { page: 'thread'; forumId: string; slug: string; threadNum: number; replyTo?: number; scrollTo?: 'top' | 'bottom'; postNum?: number }
  | { page: 'compose'; forumId: string; slug: string }
  | { page: 'settings'; setting?: SettingSlug }


export interface ForumInfo {
  forumId: string
  relayUrl: string
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
  forumErrors: Record<string, Failure | null>
  loading: boolean
  refreshing: boolean
  reconnecting: boolean
  error: Failure | null
  collapsed: boolean
}
