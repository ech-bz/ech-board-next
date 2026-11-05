import { toHex } from '../../model/content/hex'
import { senderAddress } from '../io/crypto/primitives'

export function formatDebugValue(value: unknown): unknown {
  if (value instanceof Uint8Array) return value.length === 0 ? [] : toHex(value)
  if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 255)) return toHex(new Uint8Array(value))
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(formatDebugValue)
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(source)) if (key !== '$kind') result[key] = formatDebugValue(item)
    if (source.pk instanceof Uint8Array && source.tweak instanceof Uint8Array) result.address = toHex(senderAddress(source.pk))
    return result
  }
  return value
}
