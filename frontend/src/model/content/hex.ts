import { toHex as encodeHex } from '@mysten/bcs'
export { fromHex } from '@mysten/bcs'

export const toHex = (bytes: Uint8Array): string => `0x${encodeHex(bytes)}`

export const shortHex = (value: string, head = 10, tail = 8): string =>
  value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`
