export function failure(error: unknown): string {
  console.error(error)
  return error instanceof Error ? error.message : String(error)
}
