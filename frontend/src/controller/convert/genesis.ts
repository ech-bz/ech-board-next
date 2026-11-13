import { toHex } from '../../model/content/hex'
import { identityKey } from '../../model/rules/identity'
import { parseServerContext, type ServerContextView, type Tx } from '../io/ech/protocol/entities'
import type { Esid } from '../io/ech/protocol/transactions'

export function transactionOf(genesis: Uint8Array, transactions: ReadonlyMap<string, Tx> | undefined): Tx {
  const tx = transactions?.get(toHex(genesis))
  if (!tx) throw new Error('Missing transaction')
  return tx
}

export function txAuthor(tx: Tx): Esid | null {
  const author = tx.user.author
  return author.$kind === 'User' ? author.User.esid : null
}

export function txSender(tx: Tx): string | null {
  const author = txAuthor(tx)
  return author === null ? null : identityKey(author)
}

export function txContext(tx: Tx): ServerContextView {
  return parseServerContext(tx.server.ctx)
}

export function txTime(tx: Tx): number {
  return txContext(tx).time
}

