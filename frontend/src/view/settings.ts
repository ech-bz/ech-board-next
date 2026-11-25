import type { MessageKey } from './i18n/ru'

export function settingLabel(name: string, t: (key: MessageKey) => string): string {
  if (name === 'Profile') return t('ui.profile')
  if (name === 'About') return t('ui.about')
  return t('ui.appearance')
}
