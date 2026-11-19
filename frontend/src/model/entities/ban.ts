export interface Ban {
  target: string
  author: string
  reason: string | null
  expires: number | null
}

