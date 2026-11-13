import type { BcsType } from '@mysten/bcs'
import { ArgumentSchemas } from './arguments'
import { ServerContextSchema, UserRequestsSchema, type Tx } from './entities'

function decode(schema: BcsType<any, any> | undefined, bytes: Uint8Array): unknown {
  if (!schema) return bytes
  try {
    return schema.parse(bytes)
  } catch (error) {
    return { bytes, decode_error: error instanceof Error ? error.message : String(error) }
  }
}

export function describeTransaction(tx: Tx): unknown {
  const call = tx.user.call
  const native = call.program.$kind === 'Native'
  return {
    user: {
      ...tx.user,
      ctx: decode(native ? undefined : UserRequestsSchema, tx.user.ctx),
      call: {
        ...call,
        args: decode(!native && Object.hasOwn(ArgumentSchemas, call.function) ? ArgumentSchemas[call.function] : undefined, call.args),
      },
    },
    server: { ...tx.server, ctx: decode(ServerContextSchema, tx.server.ctx) },
  }
}
