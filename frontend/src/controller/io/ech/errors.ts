import { RequestError } from '../../../model/errors'
import { convertError } from '../../convert/errors'
import { DomainErrorSchema } from './protocol/errors'

export async function responseError(response: Response): Promise<Error> {
  const contentType = response.headers.get('content-type')?.split(';')[0].trim()
  if (contentType !== 'application/octet-stream') {
    return new RequestError({ code: 'Server.Http', params: { status: response.status, message: response.statusText } })
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  try {
    return new RequestError(convertError(DomainErrorSchema.parse(bytes)))
  } catch {
    return new RequestError({ code: 'InvalidErrorResponse', params: {} })
  }
}
