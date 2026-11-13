import type { ErrorDetail } from '../../model/errors'
import { ForumErrorSchema, type ForumError, type DomainError, type ProtocolError, type SdkError, type DbError } from '../io/ech/protocol/errors'

function forumError(error: ForumError): ErrorDetail {
  if (error.$kind === 'Guest') return guestError(error.Guest)
  if (error.$kind !== 'Entity') return { code: error.$kind, params: {} }
  const entity = error.Entity
  switch (entity.$kind) {
    case 'Guest': return guestError(entity.Guest)
    case 'UnsupportedVersion': return { code: 'Entity.UnsupportedVersion', params: entity.UnsupportedVersion }
    case 'Decode': return { code: 'Entity.Decode', params: { reason: entity.Decode } }
    case 'Encode': return { code: 'Entity.Encode', params: { reason: entity.Encode } }
    case 'Message': return { code: 'Entity.Message', params: entity.Message }
    case 'UnknownFunction': return { code: 'Entity.UnknownFunction', params: entity.UnknownFunction }
    default: return { code: `Entity.${entity.$kind}`, params: {} }
  }
}

function guestError(error: NonNullable<ForumError['Guest']>): ErrorDetail {
  return { code: `Guest.${error.$kind}`, params: error.$kind === 'Bcs' ? { reason: error.Bcs } : {} }
}

export function convertError(error: DomainError): ErrorDetail {
  switch (error.$kind) {
    case 'NotFound': return { code: 'Server.NotFound', params: {} }
    case 'BadRequest': return { code: 'Server.BadRequest', params: { reason: error.BadRequest } }
    case 'Program': return { code: 'Server.Program', params: { reason: error.Program } }
    case 'Internal': return { code: 'Server.Internal', params: { reason: error.Internal } }
    case 'Codec': return { code: 'Server.Codec', params: { reason: error.Codec } }
    case 'Store': return { code: 'Server.Store', params: { reason: error.Store } }
    case 'Http': return { code: 'Server.Http', params: error.Http }
    case 'Protocol': return protocolError(error.Protocol)
    case 'Sdk': return sdkError(error.Sdk)
    case 'Db': return dbError(error.Db)
  }
}

function protocolError(error: ProtocolError): ErrorDetail {
  return { code: `Protocol.${error.$kind}`, params: error.$kind === 'Bcs' ? { reason: error.Bcs } : {} }
}

function sdkError(error: SdkError): ErrorDetail {
  if (error.$kind === 'Protocol') return protocolError(error.Protocol)
  return { code: `Sdk.${error.$kind}`, params: {} }
}

function dbError(error: DbError): ErrorDetail {
  switch (error.$kind) {
    case 'Status': return { code: 'Db.Status', params: { status: error.Status } }
    case 'Transport': return { code: 'Db.Transport', params: { reason: error.Transport } }
    case 'Codec': return { code: 'Db.Codec', params: { reason: error.Codec } }
    case 'Reject': {
      const reject = error.Reject
      if (reject.$kind === 'Application') {
        return forumError(ForumErrorSchema.parse(new Uint8Array(reject.Application.bytes)))
      }
      return { code: `Reject.${reject.$kind}`, params: reject.$kind === 'UnknownNative' ? reject.UnknownNative : {} }
    }
  }
}
