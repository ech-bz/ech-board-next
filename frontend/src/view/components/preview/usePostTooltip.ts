import { createContext, useContext } from 'solid-js'
import type { PreviewTarget } from '../../../model/state/previews'

export type PostTooltipTarget = PreviewTarget

export interface Api {
  open: (anchor: HTMLElement, target: PostTooltipTarget) => void
  isOpen: (anchor: HTMLElement) => boolean
}

export const Ctx = createContext<Api>({ open: () => {}, isOpen: () => false })

export function usePostTooltip(): Api {
  return useContext(Ctx)
}
