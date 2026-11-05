export function validBoardSlug(slug: string): boolean {
  return /^[a-z0-9-]{1,32}$/.test(slug)
}
