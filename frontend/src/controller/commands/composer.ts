import { createEffect, untrack } from 'solid-js'
import { partsToEditText } from '../../model/content/posts'
import type { ForumQueries } from '../../model/selectors/queries'
import type { ComposerChanges, ComposerMode } from '../../model/state/composer'
import type { ForumState } from '../../model/state/forum'
import type { Commit } from '../commit'
import type { ModActions } from './moderation'

export function createComposerCommands(model: ForumState, read: ForumQueries, commit: Commit, moderation: ModActions) {
  const updateComposerDraft = (mode: ComposerMode, value: ComposerChanges) => commit({ type: 'draft.patch', value: { mode, value } })
  const cancelPostEdit = () => commit({ type: 'draft.patch', value: { mode: 'reply', value: { editing: null } } })
  const complete = (mode: ComposerMode, revision: number) => {
    if (model.drafts[mode].revision !== revision) return
    commit({
      type: 'draft.patch', value: {
        mode, value: {
          text: '', name: '', files: [], withFlag: false, optionsOpen: mode === 'thread', editing: null,
          ...(mode === 'thread' ? { subject: '', selfAdmin: false } : {}),
        }
      }
    })
  }

  createEffect(() => {
    if (!read.boardObject()) return
    const roles = read.roles().filter((role) => role.selectable !== false)
    for (const mode of ['reply', 'thread'] as const) {
      if (!roles.some((role) => role.kind === model.drafts[mode].sendAsKind)) untrack(() => updateComposerDraft(mode, { sendAsKind: 'anonymous' }))
    }
  })

  createEffect(() => {
    const editing = model.drafts.reply.editing
    if (editing && (editing.forumId !== model.page.forumId || editing.threadId !== model.page.threadId)) untrack(cancelPostEdit)
  })

  return {
    updateComposerDraft,
    cancelPostEdit,
    complete,
    beginPostEdit(postId: string) {
      const info = read.info()
      const post = read.get(postId)
      if (!info || !post) return
      const current = model.drafts.reply.editing
      if (current?.forumId === info.forumId && current.postId === postId) return
      const { text, secrets } = partsToEditText(post.parts ?? [], { forumId: info.forumId, board: post.board })
      commit({
        type: 'draft.patch', value: {
          mode: 'reply', value: {
            text, optionsOpen: true,
            editing: { forumId: info.forumId, postId, threadId: post.threadId, secrets: Object.fromEntries(secrets) },
          }
        }
      })
    },
    async submitPostEdit() {
      const draft = model.drafts.reply
      const editing = draft.editing
      if (!editing || model.operations.moderating) return
      const post = read.get(editing.postId, editing.forumId)
      if (!post || !draft.text.trim()) return
      const revision = draft.revision
      const secrets = new Map(Object.entries(editing.secrets).map(([index, part]) => [Number(index), part]))
      const saved = await moderation.runPostEdit(post, editing.threadId, draft.text, secrets)
      if (saved && model.drafts.reply.revision === revision) commit({ type: 'draft.patch', value: { mode: 'reply', value: { text: '', editing: null } } })
    },
  }
}
