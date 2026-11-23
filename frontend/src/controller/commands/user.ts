import type { ForumGateway } from '../forumGateway'

export function createUserCommands(gateway: ForumGateway) {
  return {
    loadUser: (relayUrl: string) => gateway.readUser(relayUrl),
  }
}
