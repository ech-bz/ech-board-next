import { toHex } from '../../model/content/hex'
import { senderAddress } from '../io/crypto/primitives'
import { describeTransaction } from '../io/ech/protocol/debug'
import type { Tx } from '../io/ech/protocol/entities'
import { EsidSchema, ProofSchema, type Esid, type Proof } from '../io/ech/protocol/transactions'

export function formatDebugValue(value: unknown): unknown {
  if (value instanceof Uint8Array) return value.length === 0 ? [] : toHex(value)
  if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 255)) return toHex(new Uint8Array(value))
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(formatDebugValue)
  if (value !== null && typeof value === 'object') {
    if ('tweak' in value && 'c1' in value && 'c2' in value) return toHex(EsidSchema.serialize(value as Esid).toBytes())
    if ('commitment' in value && 'response' in value) return toHex(ProofSchema.serialize(value as Proof).toBytes())
    const source = ('user' in value && 'server' in value ? describeTransaction(value as Tx) : value) as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(source)) if (key !== '$kind') result[key] = formatDebugValue(item)
    if (source.pk instanceof Uint8Array && source.tweak instanceof Uint8Array) result.address = toHex(senderAddress(source.pk))
    return result
  }
  return value
}
