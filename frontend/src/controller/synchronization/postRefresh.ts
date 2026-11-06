import { onCleanup } from 'solid-js'

export function createPostRefresh(refetch: (id: string, root?: string) => Promise<void>) {
  const timers = new Set<ReturnType<typeof setTimeout>>()
  onCleanup(() => { for (const timer of timers) clearTimeout(timer) })
  return (id: string, root: string) => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      void refetch(id, root)
    }, 200)
    timers.add(timer)
  }
}
