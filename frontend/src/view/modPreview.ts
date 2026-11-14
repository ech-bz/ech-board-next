const MOD_PREVIEW_KEY = 'ech-board-mod-preview'

export function modPreviewEnabled(): boolean {
  try {
    return localStorage.getItem(MOD_PREVIEW_KEY) === '1'
  } catch {
    return false
  }
}
