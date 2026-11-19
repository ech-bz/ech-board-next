import type { BanScope } from '../model/rules/permissions'
import type { MessageKey } from './i18n/ru'

export function banScopeLabel(t: (key: MessageKey) => string, scope: BanScope): string {
  const key: MessageKey = scope === 'thread' ? 'ban.scopeThread' : scope === 'board' ? 'ban.scopeBoard' : 'ban.scopeForum'
  return t(key)
}
