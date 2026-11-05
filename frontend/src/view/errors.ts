export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function reportError(error: unknown): void {
  window.alert(errorMessage(error))
}
