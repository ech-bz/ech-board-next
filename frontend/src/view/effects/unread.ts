import { createEffect, onCleanup, untrack, type Accessor } from 'solid-js'
import { unreadCount } from '../../model/state/unread'
import { useForumController, useForumModel } from '../bindings/forum'
import type { ViewportObservation } from './threadScroll'

export function createThreadUnread(total: Accessor<number>, reloadSeq: Accessor<number>, viewport: Accessor<ViewportObservation>) {
  const model = useForumModel()
  const controller = useForumController()
  const observe = (source: 'posts' | 'viewport') => {
    const count = total()
    const reloadSequence = reloadSeq()
    const fact = viewport()
    controller.observeUnread({ total: count, reloadSequence, visible: fact.visible, atBottom: fact.y >= fact.edge - 0.5 }, source)
  }
  controller.beginUnread(reloadSeq())
  createEffect(() => {
    total()
    reloadSeq()
    untrack(() => observe('posts'))
  })
  createEffect(() => {
    viewport()
    untrack(() => observe('viewport'))
  })
  onCleanup(controller.endUnread)
  return { markerIndex: () => model.unread.markerIndex, unreadCount: () => unreadCount(model.unread) }
}
