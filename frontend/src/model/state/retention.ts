export type PostRetention = 'loaded' | 'resolved' | 'realtime'

export interface PostLifetime {
  retained: Record<string, PostRetention>
  temporary: Record<string, true>
}
