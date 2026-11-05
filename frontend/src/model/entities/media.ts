export interface Media {
  mime: string
  width: number
  height: number
  duration_ms: string | null
  size: string
  thumbnail: boolean
}

export interface MediaInfo {
  thumbUrl: string
  fullUrl: string
  width: number
  height: number
  mime: string
  size: number
  durationMs: number | null
  postId: string
  threadId: string
  hash: string
  banned: boolean
}

export interface MediaReference {
  postId: string
  hash: string
}
