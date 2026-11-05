import { forumKey } from '../../../model/selectors/forum'
import type { ForumInfo } from '../../../model/state/navigation'

export const SERVER_URL = (import.meta.env.VITE_ECH_SERVER ?? 'https://testnewech.duckdns.org/next/').replace(/\/$/, '')
export const DEFAULT_RELAY_URL = SERVER_URL

const TABS_KEY = 'ech-forum/relay-tabs'
const DEFAULT_FORUM_KEY = 'ech-forum/default-forum'

export function loadForums(): ForumInfo[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(TABS_KEY) ?? '{}')
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return []
    return Object.entries(stored).flatMap(([id, value]) => {
      const forumId = forumKey(id)
      if (!/^[a-f0-9]{64}$/.test(forumId) || typeof value !== 'string') return []
      try {
        const url = new URL(value)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return []
        const relayUrl = url.host === window.location.host ? SERVER_URL : value.replace(/\/$/, '')
        return [{ forumId, relayUrl, host: new URL(relayUrl).host }]
      } catch { return [] }
    })
  } catch { return [] }
}

export function saveForums(forums: readonly ForumInfo[]): void {
  localStorage.setItem(TABS_KEY, JSON.stringify(Object.fromEntries(forums.map((forum) => [forum.forumId, forum.relayUrl]))))
}

export function loadDefaultForumId(): string | null {
  try {
    const value = localStorage.getItem(DEFAULT_FORUM_KEY)
    return value ? forumKey(value) : null
  } catch { return null }
}

export function saveDefaultForumId(forumId: string): void {
  localStorage.setItem(DEFAULT_FORUM_KEY, forumId)
}
