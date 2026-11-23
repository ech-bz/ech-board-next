export function forceRefresh(): void {
  const url = new URL(window.location.href)
  url.searchParams.set('reload', Date.now().toString(36))
  window.location.replace(url.toString())
}
