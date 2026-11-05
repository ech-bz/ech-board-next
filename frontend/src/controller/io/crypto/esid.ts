import { fromHex } from '@mysten/bcs'
import { identityKey } from '../../../model/rules/identity'
import { EsidSchema, type Esid } from '../ech/protocol/transactions'

export function EsidBytes(esid: Esid): Uint8Array {
  return EsidSchema.serialize(esid).toBytes()
}

export const esidHex = identityKey

export function esidFromHex(value: string): Esid {
  return EsidSchema.parse(fromHex(value.replace(/^0x/, '')))
}
