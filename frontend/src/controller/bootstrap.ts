import { toHex } from '../model/content/hex'
import { forumKey } from '../model/selectors/forum'
import type { ForumState } from '../model/state/forum'
import type { Commit } from './commit'
import type { ForumGateway } from './forumGateway'
import { migrateLegacySettings } from './io/browser/legacy'
import { loadCollapsedForums, loadPreferences, loadSidebarCollapsed } from './io/browser/preferences'
import { DEFAULT_RELAY_URL, loadForums, saveForums } from './io/browser/relays'
import { loadSession, saveSession } from './io/browser/session'

export async function initializeModel(model: ForumState, commit: Commit, gateway: ForumGateway, signal: AbortSignal, notify: (error: unknown) => void): Promise<void> {
  migrateLegacySettings()
  const forums = loadForums()
  commit({ type: 'session.set', value: loadSession() }, { type: 'preferences.patch', value: loadPreferences() }, { type: 'navigation.patch', value: { forums, collapsed: loadSidebarCollapsed(), collapsedForums: loadCollapsedForums() } })
  saveSession(model.session)
  let target = model.navigation.forums.find((forum) => forum.relayUrl === DEFAULT_RELAY_URL) ?? null
  if (!target) {
    try {
      const api = await gateway.connect(DEFAULT_RELAY_URL)
      if (signal.aborted) return
      const forumId = forumKey(toHex(api.root))
      target = { forumId, relayUrl: DEFAULT_RELAY_URL }
      commit({ type: 'navigation.patch', value: { forums: [...model.navigation.forums.filter((item) => item.forumId !== forumId), target] } })
      saveForums(model.navigation.forums)
    } catch (error) {
      notify(error)
    }
  }
  const contextForum = target ?? model.navigation.forums[0] ?? null
  commit({
    type: 'navigation.patch',
    value: {
      defaultForumId: contextForum?.forumId ?? null,
      context: contextForum ? { forumId: contextForum.forumId, relayUrl: contextForum.relayUrl } : null,
    },
  })
}
