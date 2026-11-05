import type { Identity } from '../../model/entities/identity'
import type { Esid } from '../io/ech/protocol/transactions'
import { convertBytes } from './bytes'

export function convertIdentity(value: Esid, previous?: Identity | null): Identity {
  return { tweak: convertBytes(value.tweak, previous?.tweak), c1: convertBytes(value.c1, previous?.c1), c2: convertBytes(value.c2, previous?.c2) }
}
