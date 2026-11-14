import { PIP_MAX_WIDTH, PIP_MIN_WIDTH, clampPipWidth } from '../../../model/state/preferences'
import { useForumController, useForumModel } from '../../bindings/forum'

export { PIP_MAX_WIDTH, PIP_MIN_WIDTH }

export function usePlayerPrefs() {
  const model = useForumModel()
  const controller = useForumController()
  return {
    muted: () => model.preferences.muted,
    volume: () => model.preferences.volume,
    pipWidth: () => model.preferences.pipWidth,
    autoPip: () => model.preferences.autoPip,
    standardPlayer: () => model.preferences.standardPlayer,
    setPipWidth: (value: number) => controller.updatePreferences({ pipWidth: Math.round(clampPipWidth(value)) }),
    setAutoPip: (value: boolean) => controller.updatePreferences({ autoPip: value }),
    setStandardPlayer: (value: boolean) => controller.updatePreferences({ standardPlayer: value }),
    setMuted: (value: boolean) => controller.updatePreferences({ muted: value }),
    setVolume: (value: number) => controller.updatePreferences({ volume: Math.min(Math.max(value, 0), 1) }),
  }
}
