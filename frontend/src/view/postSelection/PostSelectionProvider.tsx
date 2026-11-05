import { createContext, createEffect, createMemo, onCleanup, useContext, type Accessor, type JSX } from 'solid-js'
import type { Post } from '../../model/entities/post'
import { useForumController, useForumModel } from '../bindings/forum'

export interface PostSelectionValue {
  canSelect: Accessor<boolean>
  selected: Accessor<Set<string>>
  hasSelection: Accessor<boolean>
  toggle: (id: string, shift: boolean) => void
  clear: () => void
  selectAllFromAuthor: (ref: Post, threadId: string) => void
}

export const PostSelectionContext = createContext<PostSelectionValue | null>(null)

export function PostSelectionProvider(props: { canSelect: boolean; children: JSX.Element }) {
  const model = useForumModel()
  const controller = useForumController()
  const selected = createMemo(() => new Set(model.selection.ids))
  createEffect(controller.selection.restrict)
  onCleanup(controller.selection.clear)
  const value: PostSelectionValue = {
    canSelect: () => props.canSelect,
    selected,
    hasSelection: () => model.selection.ids.length > 0,
    toggle: controller.selection.toggle,
    clear: controller.selection.clear,
    selectAllFromAuthor: (post) => controller.selection.selectAuthor(post.id),
  }
  return <PostSelectionContext.Provider value={value}>{props.children}</PostSelectionContext.Provider>
}

export function usePostSelection(): PostSelectionValue | null {
  return useContext(PostSelectionContext)
}
