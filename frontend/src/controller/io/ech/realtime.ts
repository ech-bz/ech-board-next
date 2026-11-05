export type Subscription = { kind: 'forum' | 'thread' | 'board'; id: string }

export interface RealtimeHandlers {
  onEvent: (event: string) => void
  onDrop: () => void
  onRestored: () => void
}

export class RealtimeClient {
  private source: EventSource | null = null
  private generation = 0
  private pending: { resolve: () => void; reject: (error: Error) => void } | null = null

  constructor(private handlers: RealtimeHandlers) { }

  begin(url: string, subscription: Subscription): Promise<void> {
    this.close()
    const base = url.replace(/\/$/, '')
    const source = new EventSource(`${base}/sse/${subscription.kind}/${subscription.id}`)
    this.source = source
    const ready = new Promise<void>((resolve, reject) => { this.pending = { resolve, reject } })
    let connected = false
    source.addEventListener('append', (message) => {
      if (source === this.source && connected) this.handlers.onEvent((message as MessageEvent).data)
    })
    source.addEventListener('ready', () => {
      if (source !== this.source) return
      connected = true
      if (this.pending) {
        this.pending.resolve()
        this.pending = null
      } else this.handlers.onRestored()
    })
    source.onerror = () => {
      if (source !== this.source) return
      connected = false
      this.generation++
      this.pending?.reject(new Error('SSE connection interrupted'))
      this.pending = null
      this.handlers.onDrop()
    }
    return ready
  }

  get revision(): number { return this.generation }

  close(): void {
    this.generation++
    this.source?.close()
    this.source = null
    this.pending?.reject(new Error('SSE subscription cancelled'))
    this.pending = null
  }
}
