import { forumKey } from '../../../model/selectors/forum'
import type { ForumInfo } from '../../../model/state/navigation'

export const SERVER_URL = (import.meta.env.VITE_ECH_SERVER ?? 'https://ech.u/new').replace(/\/$/, '')
export const DEFAULT_RELAY_URL = SERVER_URL

const TABS_KEY = 'ech-forum/relay-tabs'

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
        return [{ forumId, relayUrl }]
      } catch { return [] }
    })
  } catch { return [] }
}

export function saveForums(forums: readonly ForumInfo[]): void {
  localStorage.setItem(TABS_KEY, JSON.stringify(Object.fromEntries(forums.map((forum) => [forum.forumId, forum.relayUrl]))))
}
