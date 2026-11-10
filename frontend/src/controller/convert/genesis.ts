import { identityKey } from '../../model/rules/identity'
import { parseServerContext, type PostEntity, type ServerContextView } from '../io/ech/protocol/entities'
import type { Esid } from '../io/ech/protocol/transactions'

export function entityAuthor(entity: Pick<PostEntity, 'genesis'>): Esid | null {
  const author = entity.genesis.user.author
  return author.$kind === 'User' ? author.User.esid : null
}

export function entitySender(entity: Pick<PostEntity, 'genesis'>): string | null {
  const author = entityAuthor(entity)
  return author === null ? null : identityKey(author)
}

export function entityContext(entity: Pick<PostEntity, 'genesis'>): ServerContextView {
  return parseServerContext(entity.genesis.server.ctx)
}

export function entityTime(entity: Pick<PostEntity, 'genesis'>): number {
  return entityContext(entity).time
}

