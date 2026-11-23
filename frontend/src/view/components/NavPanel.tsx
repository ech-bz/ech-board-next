import { cva } from 'class-variance-authority'
import { For, Show, type JSX } from 'solid-js'
import { useI18n } from '../i18n'
import { BoardsIcon } from '../icons/BoardsIcon'
import { InfoIcon } from '../icons/InfoIcon'
import { PaletteIcon } from '../icons/PaletteIcon'
import { PanelLeftCloseIcon } from '../icons/PanelLeftCloseIcon'
import { PanelLeftOpenIcon } from '../icons/PanelLeftOpenIcon'
import { SettingsIcon } from '../icons/SettingsIcon'
import { UserIcon } from '../icons/UserIcon'
import type { Section } from '../nav'
import { settingKeyToSlug, type SettingSlug } from '../route'
import { settingLabel } from '../settings'
import { Capsule } from './Capsule'
import { IconButton } from './IconButton'
import { RelayList } from './RelayList'

const navScrollVariants = cva('flex-1 min-h-0 overflow-y-auto')
const navInnerVariants = cva('flex min-h-full flex-col pb-3')
const navPanelHeaderVariants = cva('glass-fade sticky top-0 z-header relative flex items-center px-4 py-3 min-h-header collapsed:justify-center gap-2.5')
const navPanelCollapseBtnVariants = cva('ml-auto collapsed:ml-0 hover:bg-hover')
const navSectionVariants = cva('min-h-0', {
  variants: {
    active: {
      true: 'block collapsed:flex collapsed:flex-col collapsed:items-center',
      false: 'hidden',
    },
  },
})
const navH2Variants = cva('w-full min-w-0 ellipsis text-center text-xl font-semibold leading-none')
const navListVariants = cva('px-2 collapsed:flex collapsed:w-full collapsed:flex-col collapsed:items-center collapsed:px-1')
const navItemVariants = cva('grid cursor-pointer grid-cols-[44px_1fr_auto] items-center gap-1.5 px-2 py-2.5 rounded-md collapsed:flex collapsed:w-full collapsed:justify-center collapsed:py-2.5 hover:bg-hover no-underline', {
  variants: {
    active: {
      true: 'bg-active',
    },
  },
})
const navItemIconVariants = cva('font-bold text-accent collapsed:whitespace-nowrap')
const navItemLabelVariants = cva('font-semibold text-fg collapsed:hidden')
const navItemMetaVariants = cva('text-sm text-secondary collapsed:hidden')
const globalBarCapsuleVariants = cva('sticky bottom-3 z-header mt-auto gap-2 p-2 flex items-center rounded-full glass bg-glass1', {
  variants: {
    collapsed: {
      true: 'flex-col mx-auto w-fit',
      false: 'mx-3',
    },
  },
})
const globalBarGapVariants = cva('h-6 shrink-0')
const spacerVariants = cva('flex-1')

export type { Section }

const ACCOUNT_SECTIONS: string[] = ['Account']
const APP_SECTIONS: string[] = ['Appearance', 'About']

export function NavPanel(props: {
  collapsed: boolean
  section: Section
  setting: SettingSlug | null
  onToggleCollapsed: () => void
  onOpenSetting: (setting: SettingSlug) => void
  settingsHref: string
  onNavigateSection: (section: Section) => void
}) {
  const { t } = useI18n()
  const isActiveSetting = (name: string) => settingKeyToSlug(name) === props.setting
  const title = () => (props.section === 'boards' ? t('ui.boards') : t('ui.settings'))
  return (
    <div class={navScrollVariants()}>
      <div class={navInnerVariants()}>
        <div class={navPanelHeaderVariants()}>
          <Capsule class="px-3 w-full collapsed:hidden">
            <h2 class={navH2Variants()}>{title()}</h2>
          </Capsule>
          <IconButton
            size="lg"
            variant="glass"
            class={navPanelCollapseBtnVariants()}
            aria-label={props.collapsed ? t('ui.expand') : t('ui.collapse')}
            onClick={props.onToggleCollapsed}
          >
            <Show when={props.collapsed} fallback={<PanelLeftCloseIcon width={18} height={18} />}>
              <PanelLeftOpenIcon width={18} height={18} />
            </Show>
          </IconButton>
        </div>
        <section class={navSectionVariants({ active: props.section === 'boards' })}>
          <RelayList compact={props.collapsed} />
        </section>
        <section class={navSectionVariants({ active: props.section === 'settings' })}>
          <div class={navListVariants()}>
            <For each={ACCOUNT_SECTIONS}>
              {(name) => (
                <SettingItem name={name} settingsHref={props.settingsHref} active={isActiveSetting(name)} onOpen={props.onOpenSetting}>
                  <UserIcon width={18} height={18} />
                </SettingItem>
              )}
            </For>
            <For each={APP_SECTIONS}>
              {(name) => (
                <SettingItem name={name} settingsHref={props.settingsHref} active={isActiveSetting(name)} onOpen={props.onOpenSetting}>
                  <Show when={name === 'About'} fallback={<PaletteIcon width={18} height={18} />}>
                    <InfoIcon width={18} height={18} />
                  </Show>
                </SettingItem>
              )}
            </For>
          </div>
        </section>
        <div class={globalBarGapVariants()} />
        <div class={globalBarCapsuleVariants({ collapsed: props.collapsed })}>
          <IconButton
            size="xl"
            variant={props.section === 'boards' ? 'glass' : undefined}
            onClick={() => props.onNavigateSection('boards')}
          >
            <BoardsIcon width={24} height={24} />
          </IconButton>
          <div class={spacerVariants()} />
          <IconButton
            size="xl"
            variant={props.section === 'settings' ? 'glass' : undefined}
            onClick={() => props.onNavigateSection('settings')}
          >
            <SettingsIcon width={24} height={24} />
          </IconButton>
        </div>
      </div>
    </div>
  )
}

function SettingItem(props: { name: string; settingsHref: string; active: boolean; onOpen: (slug: SettingSlug) => void; children: JSX.Element }) {
  const { t } = useI18n()
  return (
    <a
      class={navItemVariants({ active: props.active })}
      href={`${props.settingsHref}/${settingKeyToSlug(props.name)}`}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
        const slug = settingKeyToSlug(props.name)
        if (!slug) return
        e.preventDefault()
        props.onOpen(slug)
      }}
    >
      <div class={navItemIconVariants()}>{props.children}</div>
      <div class={navItemLabelVariants()}>{settingLabel(props.name, t)}</div>
    </a>
  )
}
