import { cva } from 'class-variance-authority'
import { forceRefresh } from '../../controller/io/browser/reload'
import { useI18n } from '../i18n'
import { Button } from './Button'

const pageVariants = cva('max-w-settings p-6')
const titleVariants = cva('mb-1 text-lg font-semibold text-fg leading-tight')
const listVariants = cva('mt-3 flex flex-col')
const rowVariants = cva('flex items-baseline justify-between gap-4 border-b border-separator py-2 last:border-b-0')
const labelVariants = cva('text-secondary')
const valueVariants = cva('min-w-0 text-right [overflow-wrap:anywhere]')
const idVariants = cva('min-w-0 text-right font-mono [overflow-wrap:anywhere]')
const actionRowVariants = cva('mt-4 flex items-center gap-2')

export function AboutView() {
  const { t, months } = useI18n()
  const builtAt = () => {
    const date = new Date(__BUILD_TIME__)
    const pad = (value: number) => value.toString().padStart(2, '0')
    return `${pad(date.getDate())} ${months()[date.getMonth()]} ${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  return (
    <div class={pageVariants()}>
      <div class={titleVariants()}>{t('settings.buildTitle')}</div>
      <div class={listVariants()}>
        <div class={rowVariants()}>
          <div class={labelVariants()}>{t('settings.buildId')}</div>
          <div class={idVariants()}>{__BUILD_ID__}</div>
        </div>
        <div class={rowVariants()}>
          <div class={labelVariants()}>{t('settings.buildTime')}</div>
          <div class={valueVariants()}>{builtAt()}</div>
        </div>
      </div>
      <div class={actionRowVariants()}>
        <Button onClick={() => forceRefresh()}>{t('settings.refresh')}</Button>
      </div>
    </div>
  )
}
