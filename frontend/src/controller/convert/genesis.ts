import { identityKey } from '../../model/rules/identity'
import { ServerContextSchema, type PostEntity } from '../io/ech/protocol/entities'
import type { Esid } from '../io/ech/protocol/transactions'

export function entityAuthor(entity: Pick<PostEntity, 'genesis'>): Esid | null {
  const author = entity.genesis.user.author
  return author.$kind === 'User' ? author.User.esid : null
}

export function entitySender(entity: Pick<PostEntity, 'genesis'>): string | null {
  const author = entityAuthor(entity)
  return author === null ? null : identityKey(author)
}

export function entityTime(entity: Pick<PostEntity, 'genesis'>): number {
  return Number(ServerContextSchema.parse(entity.genesis.server.ctx).time)
}

