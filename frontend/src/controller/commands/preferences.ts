import type { ForumState } from '../../model/state/forum'
import { APPEARANCES, type Preferences } from '../../model/state/preferences'
import type { Commit } from '../commit'
import { savePreferences } from '../io/browser/preferences'

export function createPreferenceCommands(model: ForumState, commit: Commit) {
  const updatePreferences = (changes: Partial<Preferences>) => {
    if (changes.appearance) {
      const found = APPEARANCES.find((appearance) => appearance.id === changes.appearance)
      if (!found) return
      changes = { ...changes, theme: found.theme }
    }
    commit({ type: 'preferences.patch', value: changes })
    savePreferences(Object.fromEntries(Object.keys(changes).map((key) => [key, model.preferences[key as keyof Preferences]])))
  }
  return {
    updatePreferences,
    setThreadHidden(id: string, hidden: boolean) {
      const ids = model.preferences.hiddenThreads.filter((value) => value !== id)
      updatePreferences({ hiddenThreads: hidden ? [...ids, id] : ids })
    },
  }
}
