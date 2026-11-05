export type Lang = 'ru' | 'en'
export type Theme = 'light' | 'dark'

export const APPEARANCES: { id: string; label: string; file?: string; theme: Theme; enabled?: boolean }[] = [
  { id: 'default_dark', label: 'Default D', file: 'default_dark.css', theme: 'dark' },
  { id: 'default_light', label: 'Default L', file: 'default_light.css', theme: 'light' },
  { id: 'yotsuba', label: 'Yotsuba', file: 'yotsuba.css', theme: 'light' },
  { id: 'matrix', label: 'Matrix', file: 'matrix.css', theme: 'dark' },
  { id: 'gurochan', label: 'Gurochan', file: 'gurochan.css', theme: 'light' },
  { id: 'neutron', label: 'Neutron', file: 'neutron.css', theme: 'dark' },
  { id: 'dark_oled', label: 'Dark OLED', file: 'dark_oled.css', theme: 'dark' },
  { id: 'yotsuba_b', label: 'Yotsuba B', file: 'yotsuba_b.css', theme: 'light', enabled: false },
  { id: 'futaba', label: 'Futaba', file: 'futaba.css', theme: 'light', enabled: false },
  { id: 'burichan', label: 'Burichan', file: 'burichan.css', theme: 'light', enabled: false },
  { id: 'tomorrow', label: 'Tomorrow', file: 'tomorrow.css', theme: 'dark', enabled: false },
  { id: 'lord_english', label: 'Lord English', file: 'lord_english.css', theme: 'dark', enabled: false },
  { id: 'sosaka_light', label: 'Sosaka Light', file: 'sosaka light.css', theme: 'light', enabled: false },
  { id: 'sosaka_dark', label: 'Sosaka Dark', file: 'sosaka dark.css', theme: 'dark', enabled: false },
]

export interface Preferences {
  lang: Lang
  theme: Theme
  appearance: string
  showDeleted: boolean
  hideThreadsCompletely: boolean
  expandFolds: boolean
  muted: boolean
  volume: number
  hiddenThreads: string[]
}

export const initialPreferences = (): Preferences => ({ lang: 'ru', theme: 'dark', appearance: 'default_dark', showDeleted: false, hideThreadsCompletely: false, expandFolds: false, muted: true, volume: 1, hiddenThreads: [] })
