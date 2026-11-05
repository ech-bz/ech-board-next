import { toHex } from '../model/content/hex'
import { forumKey } from '../model/selectors/forum'
import type { ForumState } from '../model/state/forum'
import type { Commit } from './commit'
import type { ForumGateway } from './forumGateway'
import { loadPreferences, loadSidebarCollapsed } from './io/browser/preferences'
import { DEFAULT_RELAY_URL, loadDefaultForumId, loadForums, saveDefaultForumId, saveForums } from './io/browser/relays'
import { loadSession, saveSession } from './io/browser/session'

export async function initializeModel(model: ForumState, commit: Commit, gateway: ForumGateway, signal: AbortSignal): Promise<void> {
  commit({ type: 'session.set', value: loadSession() }, { type: 'preferences.patch', value: loadPreferences() }, { type: 'navigation.patch', value: { forums: loadForums(), defaultForumId: loadDefaultForumId(), collapsed: loadSidebarCollapsed() } })
  saveSession(model.session)
  let target = model.navigation.forums.find((forum) => forum.forumId === model.navigation.defaultForumId)
  if (!target) {
    const api = await gateway.connect(DEFAULT_RELAY_URL)
    if (signal.aborted) return
    const forumId = forumKey(toHex(api.root))
    const forum = { forumId, relayUrl: DEFAULT_RELAY_URL, host: new URL(DEFAULT_RELAY_URL).host }
    commit({ type: 'navigation.patch', value: { forums: [...model.navigation.forums.filter((item) => item.forumId !== forumId), forum], defaultForumId: forumId } })
    saveForums(model.navigation.forums)
    saveDefaultForumId(forumId)
    target = forum
  }
  commit({ type: 'navigation.patch', value: { context: { forumId: target.forumId, relayUrl: target.relayUrl } } })
}
