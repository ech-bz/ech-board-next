export type ContentPath = readonly [string] | readonly [string, string] | readonly [string, string, string]

export function contentUrl(relayUrl: string, path: ContentPath, hash: string, variant?: 'thumbnail' | 'metadata'): string {
  const url = `${relayUrl.replace(/\/$/, '')}/content/${path.map(encodeURIComponent).join('/')}/${hash.replace(/^0x/, '')}`
  return variant ? `${url}?variant=${variant}` : url
}
