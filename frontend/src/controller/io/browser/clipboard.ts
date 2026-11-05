export async function writeClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    const input = document.createElement('textarea')
    input.value = value
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.appendChild(input)
    try {
      input.select()
      if (!document.execCommand('copy')) throw new Error('Clipboard is unavailable')
    } finally {
      input.remove()
    }
  }
}

export const readClipboard = (): Promise<string> => navigator.clipboard.readText()
