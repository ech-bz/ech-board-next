import type { MessageKey } from './i18n/ru'

export function settingLabel(name: string, t: (key: MessageKey) => string): string {
  if (name === 'Account') return t('ui.account')
  return t('ui.appearance')
}
