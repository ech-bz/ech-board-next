import { cva } from 'class-variance-authority'
import { haptic } from '../effects/haptic'
import { useI18n } from '../i18n'
import { usePlayerPrefs, PIP_MAX_WIDTH, PIP_MIN_WIDTH } from './Player/playerPrefs'
import { useIsMobile } from './Gallery/useIsMobile'

const pageVariants = cva('max-w-settings p-6')
const toggleRowVariants = cva('flex items-center justify-between gap-3 border-b border-separator px-0.5 py-3 text-lg')
const rangeRowVariants = cva('border-b border-separator px-0.5 py-3')
const rangeHeaderVariants = cva('flex items-center justify-between gap-3 text-lg')
const descriptionVariants = cva('mt-1 text-sm leading-normal text-secondary')
const rangeVariants = cva('mt-3 block w-full cursor-pointer accent-accent')

const toggleVariants = cva('settings-checkbox relative h-toggle w-toggle flex-none cursor-pointer appearance-none rounded-full bg-toggle-track checked:bg-toggle-on transition-colors')

export function PlayerSettingsView() {
  const { t } = useI18n()
  const prefs = usePlayerPrefs()
  const mobile = useIsMobile()
  const browserPlayerForced = () => mobile() || window.matchMedia('(pointer: coarse)').matches

  return (
    <div class={pageVariants()}>
      <label class={toggleRowVariants()}>
        <span>{t('settings.player.muted')}</span>
        <input
          ref={(el) => haptic(el)}
          type="checkbox"
          class={toggleVariants()}
          checked={prefs.muted()}
          onChange={(e) => prefs.setMuted(e.currentTarget.checked)}
        />
      </label>

      <div class={rangeRowVariants()}>
        <label class="flex items-center justify-between gap-3 px-0.5 py-3 text-lg">
          <span>{t('settings.player.autoPip')}</span>
          <input
            ref={(el) => haptic(el)}
            type="checkbox"
            class={toggleVariants()}
            checked={prefs.autoPip()}
            onChange={(e) => prefs.setAutoPip(e.currentTarget.checked)}
          />
        </label>
        <p class={descriptionVariants()}>{t('settings.player.autoPipDesc')}</p>
      </div>

      <div class={rangeRowVariants()}>
        <label class="flex items-center justify-between gap-3 px-0.5 py-3 text-lg">
          <span>{t('settings.player.standardPlayer')}</span>
          <input
            ref={(el) => haptic(el)}
            type="checkbox"
            class={toggleVariants()}
            checked={browserPlayerForced() || prefs.standardPlayer()}
            disabled={browserPlayerForced()}
            onChange={(e) => prefs.setStandardPlayer(e.currentTarget.checked)}
          />
        </label>
        <p class={descriptionVariants()}>{t('settings.player.standardPlayerDesc')}</p>
      </div>

      <div class={rangeRowVariants()}>
        <div class={rangeHeaderVariants()}>
          <label for="player-default-volume">{t('settings.player.volume')}</label>
          <output>{Math.round(prefs.volume() * 100)}%</output>
        </div>
        <input
          ref={(el) => haptic(el)}
          id="player-default-volume"
          class={rangeVariants()}
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={prefs.volume()}
          onInput={(e) => prefs.setVolume(Number(e.currentTarget.value))}
        />
      </div>

      <div class={rangeRowVariants()}>
        <div class={rangeHeaderVariants()}>
          <label for="player-pip-width">{t('settings.player.pipWidth')}</label>
          <output>{prefs.pipWidth()} px</output>
        </div>
        <input
          ref={(el) => haptic(el)}
          id="player-pip-width"
          class={rangeVariants()}
          type="range"
          min={PIP_MIN_WIDTH}
          max={PIP_MAX_WIDTH}
          step="10"
          value={prefs.pipWidth()}
          onInput={(e) => prefs.setPipWidth(Number(e.currentTarget.value))}
        />
        <p class={descriptionVariants()}>{t('settings.player.pipWidthDesc')}</p>
      </div>
    </div>
  )
}
