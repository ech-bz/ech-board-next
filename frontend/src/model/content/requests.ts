import type { PostPart } from './postPart'

export function requestsPostcount(parts: readonly PostPart[]): boolean {
  return parts.some((part) => {
    if ('Plain' in part) return part.Plain.split(/[ \t\n\r\f\v]+/).includes('/postcount')
    if ('Bold' in part) return requestsPostcount(part.Bold)
    if ('Italic' in part) return requestsPostcount(part.Italic)
    if ('Underline' in part) return requestsPostcount(part.Underline)
    if ('Overline' in part) return requestsPostcount(part.Overline)
    if ('Spoiler' in part) return requestsPostcount(part.Spoiler)
    if ('Strike' in part) return requestsPostcount(part.Strike)
    if ('Sup' in part) return requestsPostcount(part.Sup)
    if ('Sub' in part) return requestsPostcount(part.Sub)
    if ('Fold' in part) return requestsPostcount(part.Fold.children)
    return false
  })
}
