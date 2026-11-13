import { describeError, type Failure } from '../model/errors'
import { translate, useI18n, type Lang } from './i18n'
import { ru, type MessageKey } from './i18n/ru'

export function errorMessage(error: Failure, lang: Lang): string {
  if (typeof error === 'string') return error
  const key = `error.${error.code}`
  return Object.hasOwn(ru, key) ? translate(key as MessageKey, error.params, lang) : error.code
}

export function useErrors() {
  const { lang } = useI18n()
  const message = (error: Failure) => errorMessage(error, lang())
  const reportError = (error: unknown): void => {
    window.alert(message(describeError(error)))
  }

  return { errorMessage: message, reportError }
}
