import { identityKey } from '../../model/rules/identity'
import { ServerContextSchema, type PostEntity } from '../io/ech/protocol/entities'
import type { Esid } from '../io/ech/protocol/transactions'

export function entityAuthor(entity: Pick<PostEntity, 'genesis'>): Esid {
  const author = entity.genesis.user.author
  if (author.$kind !== 'User') throw new Error('entity has no user author')
  return author.User.esid
}

export function entitySender(entity: Pick<PostEntity, 'genesis'>): string {
  return identityKey(entityAuthor(entity))
}

export function entityTime(entity: Pick<PostEntity, 'genesis'>): number {
  return Number(ServerContextSchema.parse(entity.genesis.server.ctx).time)
}

