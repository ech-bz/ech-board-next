import type { MessageKey } from './i18n/ru'

export function settingLabel(name: string, t: (key: MessageKey) => string): string {
  if (name === 'Master Key') return t('ui.masterKey')
  if (name === 'Player') return t('ui.player')
  return t('ui.appearance')
}
