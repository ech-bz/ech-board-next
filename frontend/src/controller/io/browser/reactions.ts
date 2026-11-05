import { toHex } from '@mysten/bcs'
import { blake2b } from '@noble/hashes/blake2b'

export async function stageReaction(file: File): Promise<{ hash: string; preview: string; bytes: Uint8Array }> {
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
    throw new Error('Поддерживаются PNG, JPEG, GIF и WebP')
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const hash = toHex(blake2b(bytes, { dkLen: 32 }))
  const preview = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
  return { hash, preview, bytes }
}
