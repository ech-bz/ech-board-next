import { createRoot, getOwner, onCleanup, runWithOwner, type Owner } from 'solid-js'

export function createEntityLifecycle() {
  const owner = getOwner()
  const scopes = new Map<string, { owner: Owner | null; dispose: () => void; posts: Map<string, () => void> }>()
  const releaseScope = (root: string) => {
    const scope = scopes.get(root)
    if (!scope) return
    for (const dispose of scope.posts.values()) dispose()
    scope.posts.clear()
    scope.dispose()
    scopes.delete(root)
  }
  onCleanup(() => { for (const root of scopes.keys()) releaseScope(root) })
  const scopeOwner = (root: string) => {
    let scope = scopes.get(root)
    if (!scope) {
      scope = runWithOwner(owner, () => createRoot((dispose) => ({ owner: getOwner(), dispose, posts: new Map<string, () => void>() })))!
      scopes.set(root, scope)
    }
    return scope
  }
  const attach = <T>(root: string, create: () => T, postId?: string): T => {
    const scope = scopeOwner(root)
    if (!postId) return runWithOwner(scope.owner, create)!
    return runWithOwner(scope.owner, () => createRoot((dispose) => {
      scope.posts.set(postId, dispose)
      return create()
    }))!
  }
  const releasePost = (root: string, id: string) => {
    const posts = scopes.get(root)?.posts
    posts?.get(id)?.()
    posts?.delete(id)
  }
  return { attach, releasePost, releaseScope }
}

export type EntityLifecycle = ReturnType<typeof createEntityLifecycle>
