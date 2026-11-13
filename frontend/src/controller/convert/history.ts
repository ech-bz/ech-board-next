import type { HistoryEvent } from '../../model/entities/event'
import { parseServerContext, type Tx } from '../io/ech/protocol/entities'

export function convertHistory(tx: Tx): HistoryEvent {
  return { function: tx.user.call.function, time: parseServerContext(tx.server.ctx).time, tx }
}
