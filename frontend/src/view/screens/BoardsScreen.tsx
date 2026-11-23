import { cva } from 'class-variance-authority'
import { PageHeader } from '../components/PageHeader'
import { RelayList } from '../components/RelayList'
import { TabBar } from '../components/TabBar'
import { useI18n } from '../i18n'
import { useMobileTabs } from '../interactions/mobileNav'

const screenVariants = cva('flex min-h-dvh flex-col')
const contentVariants = cva('pl-[calc(1rem+env(safe-area-inset-left,0px))] pr-[calc(1rem+env(safe-area-inset-right,0px))] pb-[calc(var(--mobile-tab)+40px+env(safe-area-inset-bottom,0px))] pt-2')

export function BoardsScreen() {
  const { t } = useI18n()
  const tabs = useMobileTabs()
  return (
    <section class={screenVariants()}>
      <PageHeader title={t('ui.boards')} />
      <div class={contentVariants()}>
        <RelayList mobile />
      </div>
      <TabBar boardsActive settingsActive={false} onGoHome={tabs.goHome} onOpenSettings={tabs.openSettings} />
    </section>
  )
}
