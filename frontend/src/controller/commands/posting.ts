import type { OperationsState } from '../../model/state/operations'
import type { Commit } from '../commit'
import type { PostFormState, PostSubmitCtx } from './submitPost'
import { submitNewThread, submitReply } from './submitPost'

export type { PostFormState } from './submitPost'

export function createPostSubmit(operations: OperationsState, commit: Commit, onError: (error: unknown) => void) {
  const setCreating = (posting: boolean) => commit({ type: 'operations.patch', value: { posting } })
  const setProgress = (uploadProgress: number | null) => commit({ type: 'operations.patch', value: { uploadProgress } })
  let controller: AbortController | null = null

  const onUploadProgress = (loaded: number, total: number) => {
    if (total > 0) setProgress(loaded / total)
  }

  const cancel = () => {
    controller?.abort()
  }

  const createThread = async (ctx: PostSubmitCtx, form: PostFormState, subject: string) => {
    if (operations.posting || !form.files.length && !form.text.trim()) return null
    const current = new AbortController()
    controller = current
    setCreating(true)
    try {
      return await submitNewThread(ctx, form, subject, onUploadProgress, current.signal)
    } catch (e) {
      if (!current.signal.aborted) onError(e)
      return null
    } finally {
      if (controller === current) {
        controller = null
        setCreating(false)
        setProgress(null)
      }
    }
  }

  const createReply = async (
    ctx: PostSubmitCtx & { threadId: string; threadNumber: number },
    form: PostFormState,
  ) => {
    if (operations.posting || !form.files.length && !form.text.trim()) return null
    const current = new AbortController()
    controller = current
    setCreating(true)
    try {
      return await submitReply(ctx, form, onUploadProgress, current.signal)
    } catch (e) {
      if (!current.signal.aborted) onError(e)
      return null
    } finally {
      if (controller === current) {
        controller = null
        setCreating(false)
        setProgress(null)
      }
    }
  }

  return { createThread, createReply, cancel }
}
