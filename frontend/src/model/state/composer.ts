import type { PostPart } from '../content/postPart'
import type { RoleKind } from '../rules/roles'

export type ComposerMode = 'reply' | 'thread'

export interface ComposerDraft {
  revision: number
  editing: { forumId: string; postId: string; threadId: string; secrets: Record<number, PostPart> } | null
  text: string
  subject: string
  name: string
  sendAsKind: RoleKind
  optionsOpen: boolean
  files: File[]
  withFlag: boolean
  stripExifOn: boolean
  selfAdmin: boolean
}

export function emptyDraft(mode: ComposerMode): ComposerDraft {
  return { revision: 0, editing: null, text: '', subject: '', name: '', sendAsKind: 'anonymous', optionsOpen: mode === 'thread', files: [], withFlag: false, stripExifOn: true, selfAdmin: false }
}

export type ComposerChanges = Partial<Omit<ComposerDraft, 'revision' | 'editing'>>
