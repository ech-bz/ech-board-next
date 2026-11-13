import { contentUrl } from './url'

export function reactionUrl(relayUrl: string, hex: string, boardId: string): string {
  return contentUrl(relayUrl, [boardId], hex)
}
