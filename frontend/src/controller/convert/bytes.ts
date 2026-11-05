export function convertBytes(value: Uint8Array, previous?: Uint8Array | null): Uint8Array {
  return previous?.length === value.length && value.every((byte, index) => byte === previous[index]) ? previous : value.slice()
}
