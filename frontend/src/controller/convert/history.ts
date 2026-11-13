import type { HistoryEvent } from '../../model/entities/event'
import { parseServerContext, type Tx } from '../io/ech/protocol/entities'
import { formatDebugValue } from './debug'

export function convertHistory(tx: Tx, number: bigint | null): HistoryEvent {
  return { number, function: tx.user.call.function, time: parseServerContext(tx.server.ctx).time, tx: formatDebugValue(tx) }
}
