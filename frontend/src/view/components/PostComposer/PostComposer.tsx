import { cva } from 'class-variance-authority'
import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from 'solid-js'
import { type RoleKind } from '../../../model/rules/roles'
import { useForumController, useForumModel, useForumQueries } from '../../bindings/forum'
import { useComposerBridge } from '../../composerBridge'
import { reportError } from '../../errors'
import { useI18n } from '../../i18n'
import { ChevronDownIcon } from '../../icons/ChevronDownIcon'
import { ChevronUpIcon } from '../../icons/ChevronUpIcon'
import { ClipIcon } from '../../icons/ClipIcon'
import { SendIcon } from '../../icons/SendIcon'
import { XIcon } from '../../icons/XIcon'
import { useNav } from '../../nav'
import { IconButton } from '../IconButton'
import { FilePreview } from './FilePreview'
import { OptionsPanel } from './OptionsPanel'

const spinnerVariants = cva('size-4 animate-spin rounded-full border-2 border-track border-t-fg')
const composerRootVariants = cva(
  'glass-fade glass-fade--up sticky bottom-0 left-0 right-0 z-nav mt-auto flex flex-col gap-1.5 px-4 pt-4 pb-[max(16px,env(safe-area-inset-bottom,0px))] min-[900px]:min-h-[var(--global-bar-h)]',
)
const dropOverlayVariants = cva(
  'pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-bg text-accent uppercase [letter-spacing:0.03em]',
)
const actionRowVariants = cva('flex items-end gap-2')
const textareaVariants = cva('min-h-composer max-h-composer min-w-0 flex-1 resize-none overflow-y-hidden rounded-3xl bg-glass2 p-3 text-lg leading-5 text-fg outline-none glass transition-[height] duration-[160ms] ease-out')
const mirrorVariants = cva('box-border min-h-composer max-h-composer resize-none overflow-hidden p-3 text-lg leading-5')
const hiddenInputVariants = cva('hidden')

function isAllowedMedia(type: string): boolean {
  return (
    type.startsWith('image/') ||
    type === 'video/mp4' ||
    type === 'video/webm' ||
    type === 'audio/mpeg' ||
    type === 'audio/ogg' ||
    type === 'application/pdf'
  )
}

export function PostComposer(props: { mode?: 'reply' | 'thread'; slug?: string; nav?: JSX.Element }) {
  const { t } = useI18n()
  const store = useForumController()
  const read = useForumQueries()
  const model = useForumModel()
  const nav = useNav()
  const { setInsert } = useComposerBridge()
  const mode = () => props.mode ?? 'reply'
  const isThread = () => mode() === 'thread'
  const draft = () => model.drafts[mode()]
  const isEdit = () => draft().editing !== null
  const text = () => draft().text
  const subject = () => draft().subject
  const name = () => draft().name
  const sendAsKind = () => draft().sendAsKind
  const optionsOpen = () => draft().optionsOpen
  const files = () => draft().files
  const withFlag = () => draft().withFlag
  const stripExifOn = () => draft().stripExifOn
  const selfAdmin = () => draft().selfAdmin
  const setText = (text: string) => store.updateComposerDraft(mode(), { text })
  const setSubject = (subject: string) => store.updateComposerDraft(mode(), { subject })
  const setName = (name: string) => store.updateComposerDraft(mode(), { name })
  const setSendAsKind = (sendAsKind: RoleKind) => store.updateComposerDraft(mode(), { sendAsKind })
  const setOptionsOpen = (optionsOpen: boolean) => store.updateComposerDraft(mode(), { optionsOpen })
  const setWithFlag = (withFlag: boolean) => store.updateComposerDraft(mode(), { withFlag })
  const setStripExifOn = (stripExifOn: boolean) => store.updateComposerDraft(mode(), { stripExifOn })
  const setSelfAdmin = (selfAdmin: boolean) => store.updateComposerDraft(mode(), { selfAdmin })
  const maxMedia = () => read.boardObject()?.maxMedia ?? null
  const [dragOver, setDragOver] = createSignal(false)

  const token = {}
  let textarea: HTMLTextAreaElement | undefined
  let mirror: HTMLTextAreaElement | undefined
  let fileInput: HTMLInputElement | undefined
  let root: HTMLDivElement | undefined
  let pendingCaret: number | null = null
  let capped = false

  const roles = read.roles

  const visibleRoles = () => roles().filter((item) => item.selectable !== false)

  const canSend = () =>
    isEdit()
      ? !model.operations.moderating && text().trim().length > 0
      : !model.operations.posting && (files().length > 0 || text().trim().length > 0)

  const addFiles = (incoming: FileList | File[]) => {
    const arr = Array.from(incoming).filter((file) => isAllowedMedia(file.type))
    if (arr.length === 0) return
    let accepted = arr
    const limit = maxMedia()
    if (limit != null && limit >= 0) {
      const room = Math.max(0, limit - files().length)
      if (room < arr.length) {
        if (room === 0) {
          reportError(t('postForm.maxMediaReached', { n: limit }))
          return
        }
        reportError(t('postForm.maxMediaPartial', { n: limit, added: room, skipped: arr.length - room }))
        accepted = arr.slice(0, room)
      }
    }
    store.updateComposerDraft(mode(), { files: [...files(), ...accepted] })
  }

  const removeFile = (idx: number) => store.updateComposerDraft(mode(), { files: files().filter((_, i) => i !== idx) })

  const previewUrls = createMemo(() => {
    const urls = new Map(files().map((file) => [file, URL.createObjectURL(file)] as const))
    onCleanup(() => { for (const url of urls.values()) URL.revokeObjectURL(url) })
    return urls
  })

  const keepScrollTop = () => {
    const el = textarea
    if (el && !capped) el.scrollTop = 0
  }
  const followEnd = () => {
    const el = textarea
    if (!el) return
    if (!capped) {
      el.scrollTop = 0
      return
    }
    if (el.selectionEnd === el.value.length) el.scrollTop = el.scrollHeight
  }
  const syncHeight = () => {
    const value = text()
    const el = textarea
    const box = mirror
    if (!el || !box) return
    const wasCapped = capped
    box.style.width = `${el.clientWidth}px`
    box.value = value
    box.style.height = 'auto'
    const height = box.scrollHeight
    if (height > 0) el.style.height = `${height}px`
    const cap = Number.parseFloat(getComputedStyle(box).maxHeight)
    capped = height > cap + 1
    el.style.overflowY = capped ? 'auto' : 'hidden'
    if (!capped) el.scrollTop = 0
    if (capped !== wasCapped) syncHeight()
  }
  createEffect(() => {
    syncHeight()
    followEnd()
  })
  window.addEventListener('resize', syncHeight)
  onCleanup(() => window.removeEventListener('resize', syncHeight))

  const insertTag = (tag: string) => {
    const el = textarea
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const before = text().slice(0, start)
    const selected = text().slice(start, end)
    const after = text().slice(end)
    let next: string
    if (tag === 'url') {
      next = before + `[url=]${selected}[/url]` + after
    } else if (tag === 'fold') {
      next = before + `[fold=]${selected}[/fold]` + after
    } else if (selected) {
      next = before + `[${tag}]${selected}[/${tag}]` + after
    } else {
      next = before + `[${tag}][/${tag}]` + after
    }
    const openingTagLength = tag === 'url' ? '[url=]'.length : tag === 'fold' ? '[fold=]'.length : tag.length + 2
    pendingCaret = start + openingTagLength + selected.length
    setText(next)
  }

  const insertReply = (quote: string) => {
    const el = textarea
    const ins = `${quote}\n`
    const start = el ? el.selectionStart : 0
    const end = el ? el.selectionEnd : 0
    pendingCaret = start + ins.length
    setText(`${text().slice(0, start)}${ins}${text().slice(end)}`)
  }

  createEffect(() => {
    const el = textarea
    const pos = pendingCaret
    text()
    if (!el || pos == null) return
    pendingCaret = null
    el.focus()
    el.setSelectionRange(pos, pos)
    followEnd()
  })

  createEffect(() => {
    setInsert(insertReply, token, () => !!root && root.getClientRects().length > 0)
    onCleanup(() => setInsert(null, token))
  })

  const createThread = async () => {
    if (!props.slug) return
    const result = await store.submitThread(props.slug)
    if (result) nav.navigate({ page: 'thread', forumId: result.forumId, slug: result.slug, threadNum: result.thread })
  }

  const submit = () => {
    if (isEdit()) void store.submitPostEdit()
    else if (isThread()) void createThread()
    else void store.submitReply(props.slug ?? '')
  }

  return (
    <div
      ref={root}
      data-composer=""
      class={composerRootVariants()}
      onDragEnter={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        addFiles(e.dataTransfer?.files ?? [])
      }}
      onPaste={(e) => {
        const items = e.clipboardData?.items
        if (!items) return
        const media: File[] = []
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          if (isAllowedMedia(item.type)) {
            const file = item.getAsFile()
            if (file) media.push(file)
          }
        }
        if (media.length > 0) {
          e.preventDefault()
          addFiles(media)
        }
      }}
    >
      {props.nav}
      <div class="pointer-events-none invisible absolute left-0 top-0 h-0 w-0 overflow-hidden">
        <textarea ref={mirror} class={mirrorVariants()} rows={1} tabIndex={-1} aria-hidden="true" />
      </div>
      <Show when={dragOver()}>
        <div class={dropOverlayVariants()}>{t('postForm.dropHere')}</div>
      </Show>
      <Show when={optionsOpen()}>
        <OptionsPanel
          isEdit={isEdit()}
          isThread={isThread()}
          name={name()}
          onNameChange={setName}
          sendAsKind={sendAsKind()}
          onSendAsKindChange={setSendAsKind}
          roles={visibleRoles()}
          selfAdmin={selfAdmin()}
          onSelfAdminChange={setSelfAdmin}
          subject={subject()}
          onSubjectChange={setSubject}
          withFlag={withFlag()}
          onWithFlagChange={setWithFlag}
          stripExifOn={stripExifOn()}
          onStripExifChange={setStripExifOn}
          onInsertTag={insertTag}
        />
      </Show>
      <Show when={files().length > 0}>
        <FilePreview files={files()} previewUrls={previewUrls()} onRemove={removeFile} />
      </Show>
      <div class={actionRowVariants()}>
        <input
          ref={fileInput}
          type="file"
          accept="image/*,video/mp4,video/webm,audio/mpeg,audio/ogg,application/pdf"
          multiple
          class={hiddenInputVariants()}
          onChange={(e) => {
            const selected = e.currentTarget.files
            if (selected) addFiles(selected)
          }}
        />
        <Show when={!isEdit() && !isThread()}>
          <IconButton size="lg" variant="glass" active={optionsOpen()} title={t('postForm.options')} onClick={() => setOptionsOpen(!optionsOpen())}>
            <Show when={optionsOpen()} fallback={<ChevronUpIcon />}>
              <ChevronDownIcon />
            </Show>
          </IconButton>
        </Show>
        <Show when={!isEdit()}>
          <IconButton size="lg" variant="glass" title={t('postForm.addFile')} onClick={() => fileInput?.click()}>
            <ClipIcon />
          </IconButton>
        </Show>
        <textarea
          ref={textarea}
          class={textareaVariants()}
          placeholder={isThread() ? t('postForm.commentOp') : t('postForm.comment')}
          rows={1}
          value={text()}
          onScroll={keepScrollTop}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              if (canSend()) submit()
            }
          }}
        />
        <Show when={isEdit()}>
          <IconButton size="lg" variant="glass" title={t('mod.cancel')} onClick={store.cancelPostEdit}>
            <XIcon width={18} height={18} />
          </IconButton>
        </Show>
        <IconButton
          size="lg"
          variant="glass"
          disabled={!canSend()}
          onClick={submit}
          title={isEdit() ? t('mod.save') : t('postForm.submit')}
        >
          <Show when={isEdit() ? model.operations.moderating : model.operations.posting} fallback={<SendIcon />}>
            <span class={spinnerVariants()} />
          </Show>
        </IconButton>
      </div>
    </div>
  )
}
