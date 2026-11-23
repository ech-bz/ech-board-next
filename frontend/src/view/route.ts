import { useForumModel } from './bindings/forum'

import type { Route, SettingKey, SettingSlug } from '../model/state/navigation'
export type { Route, SettingKey, SettingSlug } from '../model/state/navigation'

const SETTINGS: { slug: SettingSlug; key: SettingKey }[] = [
  { slug: 'account', key: 'Account' },
  { slug: 'appearance', key: 'Appearance' },
]

const LEGACY_SETTINGS: Record<string, SettingSlug> = { user: 'account', key: 'account' }

export function settingKeyToSlug(key: string): SettingSlug | null {
  const found = SETTINGS.find((s) => s.key === key)
  return found ? found.slug : null
}

export function canonicalSettingSlug(slug: string): SettingSlug | null {
  const canonical = LEGACY_SETTINGS[slug] ?? slug
  return SETTINGS.some((s) => s.slug === canonical) ? canonical as SettingSlug : null
}

export function settingSlugToKey(slug: string): SettingKey | null {
  const canonical = canonicalSettingSlug(slug)
  const found = canonical ? SETTINGS.find((s) => s.slug === canonical) : undefined
  return found ? found.key : null
}

function isDefaultForum(forumId: string, def: string | null): boolean {
  if (!def) return false
  const norm = (s: string) => s.replace(/^0x/i, '').toLowerCase()
  const a = norm(forumId)
  const b = norm(def)
  return a === b || a.startsWith(b) || b.startsWith(a)
}

export function boardPath(forumId: string, slug: string, defaultForumId: string | null): string {
  return isDefaultForum(forumId, defaultForumId) ? `/${slug}` : `/forum/${forumId}/${slug}`
}

export function threadPath(forumId: string, slug: string, threadNum: number, postNum: number | undefined, defaultForumId: string | null): string {
  const base = isDefaultForum(forumId, defaultForumId) ? `/${slug}/${threadNum}` : `/forum/${forumId}/${slug}/${threadNum}`
  return postNum != null ? `${base}#${postNum}` : base
}

export function composePath(forumId: string, slug: string, defaultForumId: string | null): string {
  return `${boardPath(forumId, slug, defaultForumId)}/new`
}

export function parseRoute(path: string, defaultForumId: string | null): Route {
  const [pathname, hash] = path.split('#')
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 0) return { page: 'boards' }
  if (parts[0] === 'settings') {
    if (parts.length === 1) return { page: 'settings' }
    if (parts.length === 2) {
      const setting = canonicalSettingSlug(parts[1])
      if (setting) return { page: 'settings', setting }
    }
    return { page: 'boards' }
  }
  if (parts[0] === 'forum') {
    if (parts.length === 3) return { page: 'board', forumId: parts[1], slug: parts[2] }
    if (parts.length === 4 && parts[3] === 'new') return { page: 'compose', forumId: parts[1], slug: parts[2] }
    if (parts.length === 4 && /^\d+$/.test(parts[3])) {
      const threadNum = parseInt(parts[3], 10)
      const postNum = hash && /^\d+$/.test(hash) ? parseInt(hash, 10) : undefined
      return { page: 'thread', forumId: parts[1], slug: parts[2], threadNum, postNum }
    }
    return { page: 'boards' }
  }
  if (parts.length === 1 && defaultForumId) {
    return { page: 'board', forumId: defaultForumId, slug: parts[0] }
  }
  if (parts.length === 2 && defaultForumId) {
    if (parts[1] === 'new') return { page: 'compose', forumId: defaultForumId, slug: parts[0] }
    if (/^\d+$/.test(parts[1])) {
      const threadNum = parseInt(parts[1], 10)
      const postNum = hash && /^\d+$/.test(hash) ? parseInt(hash, 10) : undefined
      return { page: 'thread', forumId: defaultForumId, slug: parts[0], threadNum, postNum }
    }
  }
  return { page: 'boards' }
}

export function routeToPath(r: Route, defaultForumId: string | null): string {
  if (r.page === 'boards') return '/'
  if (r.page === 'board') return boardPath(r.forumId, r.slug, defaultForumId)
  if (r.page === 'thread') return threadPath(r.forumId, r.slug, r.threadNum, r.postNum, defaultForumId)
  if (r.page === 'compose') return composePath(r.forumId, r.slug, defaultForumId)
  return r.setting ? `/settings/${r.setting}` : '/settings'
}

export function depthOf(r: Route): number {
  if (r.page === 'boards') return 0
  if (r.page === 'board') return 1
  if (r.page === 'thread') return 2
  if (r.page === 'compose') return 3
  return r.setting ? 2 : 1
}

export function parentRoute(r: Route): Route | null {
  if (r.page === 'thread') return { page: 'board', forumId: r.forumId, slug: r.slug }
  if (r.page === 'compose') return { page: 'board', forumId: r.forumId, slug: r.slug }
  if (r.page === 'board') return { page: 'boards' }
  if (r.page === 'settings' && r.setting) return { page: 'settings' }
  return null
}

export function useRoutes() {
  const model = useForumModel()
  return {
    boardPath: (forumId: string, slug: string) => boardPath(forumId, slug, model.navigation.defaultForumId),
    threadPath: (forumId: string, slug: string, threadNum: number, postNum?: number) => threadPath(forumId, slug, threadNum, postNum, model.navigation.defaultForumId),
    composePath: (forumId: string, slug: string) => composePath(forumId, slug, model.navigation.defaultForumId),
    routeToPath: (route: Route) => routeToPath(route, model.navigation.defaultForumId),
  }
}
