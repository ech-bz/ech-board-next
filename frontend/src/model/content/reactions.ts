export function reactionUrl(relayUrl: string, hex: string): string {
  return `${relayUrl.replace(/\/$/, '')}/reaction/${hex.replace(/^0x/, '')}`
}
