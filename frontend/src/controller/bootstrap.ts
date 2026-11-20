import { toHex } from '../model/content/hex'
import { forumKey } from '../model/selectors/forum'
import type { ForumState } from '../model/state/forum'
import type { Commit } from './commit'
import type { ForumGateway } from './forumGateway'
import { migrateLegacySettings } from './io/browser/legacy'
import { loadPreferences, loadSidebarCollapsed } from './io/browser/preferences'
import { DEFAULT_RELAY_URL, loadForums, saveForums } from './io/browser/relays'
import { loadSession, saveSession } from './io/browser/session'
import { relayEndpoint } from './io/ech/resolve'

export async function initializeModel(model: ForumState, commit: Commit, gateway: ForumGateway, signal: AbortSignal, notify: (error: unknown) => void): Promise<void> {
  migrateLegacySettings()
  const forums = loadForums()
  await Promise.all(
    forums.map(async (forum) => {
      try {
        await relayEndpoint(forum.relayUrl)
      } catch (error) {
        notify(error)
      }
    }),
  )
  commit({ type: 'session.set', value: loadSession() }, { type: 'preferences.patch', value: loadPreferences() }, { type: 'navigation.patch', value: { forums, collapsed: loadSidebarCollapsed() } })
  saveSession(model.session)
  let target = model.navigation.forums.find((forum) => forum.relayUrl === DEFAULT_RELAY_URL) ?? null
  if (!target) {
    const api = await gateway.connect(DEFAULT_RELAY_URL)
    if (signal.aborted) return
    const forumId = forumKey(toHex(api.root))
    target = { forumId, relayUrl: DEFAULT_RELAY_URL }
    commit({ type: 'navigation.patch', value: { forums: [...model.navigation.forums.filter((item) => item.forumId !== forumId), target] } })
    saveForums(model.navigation.forums)
  }
  commit({ type: 'navigation.patch', value: { defaultForumId: target.forumId, context: { forumId: target.forumId, relayUrl: target.relayUrl } } })
}
