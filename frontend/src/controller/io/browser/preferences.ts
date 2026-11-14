import { APPEARANCES, clampPipWidth, initialPreferences, type Preferences } from '../../../model/state/preferences'

const keys: Record<keyof Preferences, string> = {
  lang: 'ech-board-lang', theme: 'ech-board-theme', appearance: 'ech-board-appearance',
  showDeleted: 'ech-board-show-deleted', hideThreadsCompletely: 'ech-board-hide-threads', expandFolds: 'ech-board-expand-folds',
  muted: 'ech-board-video-muted', volume: 'ech-board-video-volume', pipWidth: 'ech-board-pip-width',
  autoPip: 'ech-board-auto-pip', standardPlayer: 'ech-board-standard-player',
  hiddenThreads: 'ech-board-hidden-threads',
}

function read(key: keyof Preferences): string | null {
  try { return localStorage.getItem(keys[key]) } catch { return null }
}

export function loadPreferences(): Preferences {
  const preferences = initialPreferences()
  preferences.lang = read('lang') === 'en' ? 'en' : 'ru'
  const savedAppearance = read('appearance')
  const appearance = APPEARANCES.find((item) => item.id === savedAppearance)
  preferences.appearance = appearance?.id ?? preferences.appearance
  preferences.theme = appearance?.theme ?? (read('theme') === 'light' ? 'light' : 'dark')
  for (const key of ['showDeleted', 'hideThreadsCompletely', 'expandFolds', 'muted', 'autoPip', 'standardPlayer'] as const) {
    const value = read(key)
    if (value === 'true' || value === 'false') preferences[key] = value === 'true'
  }
  const autoPip = read('autoPip')
  if (autoPip === null) {
    try {
      const previousPipAlways = localStorage.getItem('ech-board-pip-always')
      if (previousPipAlways === 'true' || previousPipAlways === 'false') {
        preferences.autoPip = previousPipAlways === 'true'
      }
    } catch { }
  }
  const volume = read('volume')
  if (volume !== null && Number.isFinite(Number(volume))) preferences.volume = Math.max(0, Math.min(1, Number(volume)))
  const pipWidth = read('pipWidth')
  if (pipWidth !== null && Number.isFinite(Number(pipWidth)) && Number(pipWidth) > 0) preferences.pipWidth = clampPipWidth(Number(pipWidth))
  try {
    const hidden: unknown = JSON.parse(read('hiddenThreads') ?? '[]')
    if (Array.isArray(hidden)) preferences.hiddenThreads = hidden.filter((value): value is string => typeof value === 'string')
  } catch { }
  return preferences
}

export function savePreferences(changes: Partial<Preferences>): void {
  for (const key of Object.keys(changes) as (keyof Preferences)[]) {
    try { localStorage.setItem(keys[key], key === 'hiddenThreads' ? JSON.stringify(changes[key]) : String(changes[key])) } catch { }
  }
}

export function loadSidebarCollapsed(): boolean {
  try { return localStorage.getItem('nav-collapsed') === '1' } catch { return false }
}

export function saveSidebarCollapsed(collapsed: boolean): void {
  try { localStorage.setItem('nav-collapsed', collapsed ? '1' : '0') } catch { }
}
