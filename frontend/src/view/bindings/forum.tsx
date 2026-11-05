import { createContext, useContext, type Accessor, type JSX } from 'solid-js'
import type { ForumController, ForumRuntime } from '../../controller/createController'
import type { Board } from '../../model/entities/board'
import type { Post } from '../../model/entities/post'
import type { Thread } from '../../model/entities/thread'
import { currentScope } from '../../model/selectors/forum'
import type { ForumState } from '../../model/state/forum'
import type { StaticInfo } from '../../model/state/page'

const ForumContext = createContext<ForumRuntime>()

export function ForumProvider(props: { runtime: ForumRuntime; children: JSX.Element }) {
  return <ForumContext.Provider value={props.runtime}>{props.children}</ForumContext.Provider>
}

export function useForumController(): ForumController {
  const store = useContext(ForumContext)
  if (!store) throw new Error('Forum controller is missing')
  return store.commands
}

export function useForumModel(): Readonly<ForumState> {
  const runtime = useContext(ForumContext)
  if (!runtime) throw new Error('Forum model is missing')
  return runtime.model
}

export function useForumQueries() {
  const runtime = useContext(ForumContext)
  if (!runtime) throw new Error('Forum model is missing')
  return runtime.read
}

export function usePostModel(id: string): Accessor<Post | undefined> {
  const model = useForumModel()
  return () => currentScope(model)?.entities.posts[id]
}

export function usePostSource(id: Accessor<string>): Accessor<Post | undefined> {
  const model = useForumModel()
  return () => currentScope(model)?.entities.posts[id()]
}

export function usePage(): Accessor<Thread | null> {
  const read = useForumQueries()
  return read.page
}

export function useBoardInfo(): Accessor<Board | null> {
  const read = useForumQueries()
  return read.boardInfo
}

export function useLoadingMore(): Accessor<boolean> {
  return useForumQueries().loadingMoreThreads
}

export function useStaticInfo(): Accessor<StaticInfo | null> {
  return useForumQueries().info
}

export function useThreadIds(showDeleted: Accessor<boolean>): Accessor<readonly string[]> {
  const read = useForumQueries()
  return () => read.rowIds(showDeleted())
}

export function useThreadModel(id: string): Accessor<Thread | undefined> {
  const model = useForumModel()
  return () => currentScope(model)?.entities.threads[id]
}


