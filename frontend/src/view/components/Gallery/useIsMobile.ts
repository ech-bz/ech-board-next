import { createSignal } from 'solid-js'

const query = window.matchMedia('(max-width: 899px)')
const [mobile, setMobile] = createSignal(query.matches)
const onChange = () => setMobile(query.matches)

query.addEventListener('change', onChange)
import.meta.hot?.dispose(() => query.removeEventListener('change', onChange))

export function useIsMobile(): () => boolean {
  return mobile
}
