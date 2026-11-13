export interface PostReference {
  readonly postId: string
  readonly number: number
  readonly forumId?: string
  readonly board: string
  readonly threadNumber?: number
}

export interface PostReferences {
  items: PostReference[]
  positions: Record<string, number>
  revision: number
}
