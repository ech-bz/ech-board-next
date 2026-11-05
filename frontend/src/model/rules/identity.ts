import { toHex } from '@mysten/bcs'
import type { Identity } from '../entities/identity'

export function identityKey(identity: Identity): string {
  return [identity.tweak, identity.c1, identity.c2]
    .map(toHex)
    .join('')
}

export function optionalIdentityKey(identity: Identity | null): string | null {
  return identity ? identityKey(identity) : null
}
