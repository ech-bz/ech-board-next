import { describeError, type Failure } from '../model/errors'

export function failure(error: unknown): Failure {
  console.error(error)
  return describeError(error)
}
