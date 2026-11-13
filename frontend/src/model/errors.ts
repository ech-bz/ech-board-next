export interface ErrorDetail {
  code: string
  params: Record<string, string | number>
}

export type Failure = string | ErrorDetail

export class RequestError extends Error {
  constructor(readonly detail: ErrorDetail) {
    super(detail.code)
    this.name = 'RequestError'
  }
}

export function describeError(error: unknown): Failure {
  if (error instanceof RequestError) return error.detail
  return error instanceof Error ? error.message : String(error)
}
