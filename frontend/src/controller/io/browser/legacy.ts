const DROPPED = [
  'ech-board-active-tab',
  'ech-board-animate-media',
  'ech-board-animate-overflow',
  'ech-board-auto-refresh',
  'ech-board-default-forum',
  'ech-board-expand-threads',
  'ech-board-hide-thread-btn',
  'ech-board-keypair',
  'ech-board-live',
  'ech-board-mobile-icons',
  'ech-board-post-gaps',
  'ech-board-relay-tabs',
  'ech-board-scale-thumbs',
  'ech-board-sort-replies',
  'ech-forum/default-forum',
  'hidden-threads',
]

function masterFromKeypair(value: string): string | null {
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || !('secretKey' in parsed)) return null
  const secret = (parsed as { secretKey: unknown }).secretKey
  if (typeof secret !== 'string') return null
  const hex = secret.replace(/^0x/, '').toLowerCase()
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null
}

export function migrateLegacySettings(): void {
  try {
    if (localStorage.getItem('ech-board-expand-folds') === null) {
      const expand = localStorage.getItem('ech-board-expand-threads')
      if (expand !== null) localStorage.setItem('ech-board-expand-folds', expand)
    }
    if (localStorage.getItem('ech-board/master') === null) {
      const keypair = localStorage.getItem('ech-board-keypair')
      const master = keypair === null ? null : masterFromKeypair(keypair)
      if (master !== null) localStorage.setItem('ech-board/master', master)
    }
    for (const key of DROPPED) localStorage.removeItem(key)
  } catch { }
}
