import { toHex as encodeHex } from '@mysten/bcs'
export { fromHex } from '@mysten/bcs'

export const toHex = (bytes: Uint8Array): string => `0x${encodeHex(bytes)}`
