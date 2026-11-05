import { toHex } from '@mysten/bcs'
import type { SessionState } from '../../../model/state/session'
import { Identity } from '../crypto/identity'

const MASTER = 'ech-board/master'

export function loadSession(): SessionState {
  const master = Identity.fromHex(localStorage.getItem(MASTER) ?? toHex(crypto.getRandomValues(new Uint8Array(32)))).hex()
  return { master }
}

export function saveSession(state: SessionState): void {
  localStorage.setItem(MASTER, state.master)
}
