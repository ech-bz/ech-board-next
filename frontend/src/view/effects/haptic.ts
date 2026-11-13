import { onCleanup } from 'solid-js'

export function haptic(el: HTMLInputElement): void {
  el.setAttribute('switch', '')
  const vibrate = () => navigator.vibrate?.(30)
  el.addEventListener('change', vibrate)
  onCleanup(() => el.removeEventListener('change', vibrate))
}
