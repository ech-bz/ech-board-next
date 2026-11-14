import { createContext, createEffect, useContext, type Accessor, type JSX } from 'solid-js'
import { en } from './en'
import type { Dict, MessageKey } from './ru'
import { ru } from './ru'

import { APPEARANCES, type Lang, type Theme } from '../../model/state/preferences'
import { useForumController, useForumModel } from '../bindings/forum'
export { APPEARANCES, type Lang, type Theme } from '../../model/state/preferences'

const dicts: Record<Lang, Dict> = { ru, en }

const APPEARANCE_CSS = import.meta.glob('../appearances/*.css', { query: '?url', import: 'default', eager: true }) as Record<string, string>

export function translate(key: MessageKey, vars?: Record<string, string | number>, lang: Lang = 'ru'): string {
  let message: string = dicts[lang][key]
  if (vars) {
    for (const key of Object.keys(vars)) message = message.replace(`{${key}}`, String(vars[key]))
  }
  return message
}

export interface I18nValue {
  lang: Accessor<Lang>
  setLang: (l: Lang) => void
  theme: Accessor<Theme>
  setTheme: (t: Theme) => void
  appearance: Accessor<string>
  setAppearance: (id: string) => void
  showDeleted: Accessor<boolean>
  setShowDeleted: (v: boolean) => void
  hideThreadsCompletely: Accessor<boolean>
  setHideThreadsCompletely: (v: boolean) => void
  expandFolds: Accessor<boolean>
  setExpandFolds: (v: boolean) => void
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
  days: Accessor<readonly string[]>
  months: Accessor<readonly string[]>
}

const I18nContext = createContext<I18nValue>()

export function I18nProvider(props: { children: JSX.Element }) {
  const model = useForumModel()
  const controller = useForumController()
  const lang = () => model.preferences.lang
  const theme = () => model.preferences.theme
  const appearance = () => model.preferences.appearance
  const showDeleted = () => model.preferences.showDeleted
  const hideThreadsCompletely = () => model.preferences.hideThreadsCompletely
  const expandFolds = () => model.preferences.expandFolds
  const setLang = (lang: Lang) => controller.updatePreferences({ lang })
  const setTheme = (theme: Theme) => controller.updatePreferences({ theme })
  const setAppearance = (appearance: string) => controller.updatePreferences({ appearance })
  const setShowDeleted = (showDeleted: boolean) => controller.updatePreferences({ showDeleted })
  const setHideThreadsCompletely = (hideThreadsCompletely: boolean) => controller.updatePreferences({ hideThreadsCompletely })
  const setExpandFolds = (expandFolds: boolean) => controller.updatePreferences({ expandFolds })

  createEffect(() => {
    const found = APPEARANCES.find((item) => item.id === appearance())
    const href = found?.file ? APPEARANCE_CSS[`../appearances/${found.file}`] : null
    let link = document.querySelector<HTMLLinkElement>('link[data-appearance]')
    if (!href) {
      link?.remove()
      return
    }
    if (!link) {
      link = document.createElement('link')
      link.rel = 'stylesheet'
      link.setAttribute('data-appearance', '')
      document.head.appendChild(link)
    }
    link.href = href
  })

  createEffect(() => {
    document.documentElement.setAttribute('data-theme', theme())
  })

  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(key, vars, lang())

  const value: I18nValue = {
    lang,
    setLang,
    theme,
    setTheme,
    appearance,
    setAppearance,
    showDeleted,
    setShowDeleted,
    hideThreadsCompletely,
    setHideThreadsCompletely,
    expandFolds,
    setExpandFolds,
    t,
    days: () => dicts[lang()].days,
    months: () => dicts[lang()].months,
  }

  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used within I18nProvider')
  return value
}

export function I18nLocaleScope(props: { lang: Lang; active?: Accessor<boolean>; children: JSX.Element }) {
  const parent = useI18n()
  const locale = () => (props.active ? (props.active() ? props.lang : parent.lang()) : props.lang)
  const t = (key: MessageKey, vars?: Record<string, string | number>) => {
    let s = dicts[locale()][key]
    if (vars) {
      for (const k of Object.keys(vars)) s = s.replace(`{${k}}`, String(vars[k]))
    }
    return s
  }
  const value: I18nValue = {
    ...parent,
    lang: locale,
    t,
    days: () => dicts[locale()].days,
    months: () => dicts[locale()].months,
  }
  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>
}
