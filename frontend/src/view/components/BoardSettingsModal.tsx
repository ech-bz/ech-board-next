import { cva } from 'class-variance-authority'
import { createEffect, createSignal, For, Show } from 'solid-js'
import { reactionUrl } from '../../model/content/reactions'
import { resourceKey } from '../../model/state/resources'
import { useForumController, useForumModel } from '../bindings/forum'
import { reportError } from '../errors'
import { useI18n } from '../i18n'

import { fromHex, toHex } from '../../model/content/hex'
import type { Board } from '../../model/entities/board'

import { Button } from './Button'
import { Field } from './Field'
import { IconButton } from './IconButton'
import { Modal } from './Modal'

const sectionVariants = cva('mb-4')
const labelVariants = cva('mb-2 font-bold')
const rowVariants = cva('flex flex-wrap items-center gap-2')
const fileLabelVariants = cva('inline-block cursor-pointer rounded-md bg-panel2 px-3 py-2 text-md text-fg')
const chipRowVariants = cva('mt-2.5 flex flex-wrap items-center gap-2.5')
const chipVariants = cva('relative size-12 overflow-hidden rounded-md bg-panel2')
const chipImgVariants = cva('size-full object-cover')
const chipRemoveVariants = cva('absolute right-0.5 top-0.5 bg-scrim text-sm leading-none')
const listVariants = cva('mt-2.5 flex flex-col gap-1.5')
const listItemVariants = cva('flex items-center gap-2 rounded-md bg-panel2 px-2.5 py-1.5 font-mono text-sm text-secondary break-all')
const listRemoveVariants = cva('cursor-pointer border-0 bg-transparent text-fg')
const toggleLabelVariants = cva('flex items-center gap-2 text-lg')
const hiddenInputVariants = cva('hidden')

function parseEsid(s: string): string | null {
  const clean = s.replace(/^0x/, '')
  return clean.length === 192 && /^[0-9a-fA-F]+$/.test(clean) ? clean.toLowerCase() : null
}

export interface BoardModActions {
  busy: boolean
  runBoardSetDescription: (text: string) => Promise<void>
  runBoardSetMaxMedia: (v: number) => Promise<void>
  runBoardSetBumpLimit: (v: number) => Promise<void>
  runBoardSetIgnoreForumBans: (v: boolean) => Promise<void>
  runBoardSetReactions: (vals: Uint8Array[]) => Promise<void>
  runBoardSetPinned: (pinned: number[]) => Promise<void>
  runBoardAddModerator: (target: string) => Promise<void>
  runBoardDelModerator: (target: string) => Promise<void>
}

export function BoardSettingsModal(props: {
  onClose: () => void
  board: Board
  description: string
  moderators: string[]
  relayUrl: string
  boardId: string
  canCore: boolean
  canSoft: boolean
  mod: BoardModActions
}) {
  const { t } = useI18n()
  const controller = useForumController()
  const model = useForumModel()
  const [desc, setDesc] = createSignal('')
  const [maxMedia, setMaxMedia] = createSignal('')
  const [bumpLimit, setBumpLimit] = createSignal('')
  const [ignoreBans, setIgnoreBans] = createSignal(false)
  const [reactions, setReactions] = createSignal<Uint8Array[]>([])
  const [pinned, setPinned] = createSignal<number[]>([])
  const [newPin, setNewPin] = createSignal('')
  const [newMod, setNewMod] = createSignal('')

  createEffect(() => {
    setDesc(props.description)
    const bp = props.board
    setMaxMedia(String(bp.maxMedia))
    setBumpLimit(String(bp.bumpLimit))
    setIgnoreBans(!!bp.ignoreForumBans)
    setReactions(((bp.reactions as Uint8Array[] | undefined) ?? []).map((entry) => new Uint8Array(entry)))
    setPinned(bp.pinned)
    setNewPin('')
    setNewMod('')
  })

  const saveNumber = (fn: (v: number) => void) => (raw: string) => {
    const n = Number.parseInt(raw, 10)
    if (!Number.isNaN(n)) void fn(n)
  }

  const onReactionFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const hex = await controller.stageReaction(props.relayUrl, file)
    const hash = fromHex(hex)
    if (reactions().some((entry) => toHex(entry) === toHex(hash))) return
    setReactions([...reactions(), hash])
  }

  const saveReactions = async () => {
    await props.mod.runBoardSetReactions(reactions())

    setReactions(reactions().map(hash => new Uint8Array(hash)))
  }

  const copyReactions = async () => {
    if (reactions().length === 0) return
    try {
      await controller.copyReactions(reactions())
    } catch {
      return
    }
  }

  const pasteReactions = async () => {
    const parsed = await controller.pasteReactions()
    const next = [...reactions()]
    for (const entry of parsed) {
      const hex = toHex(entry)
      if (!next.some((item) => toHex(item) === hex)) next.push(entry)
    }
    setReactions(next)
  }

  const addPin = () => {
    const number = Number.parseInt(newPin(), 10)
    if (Number.isNaN(number) || pinned().includes(number)) return
    setPinned([...pinned(), number])
    setNewPin('')
  }

  const addModerator = () => {
    const esid = parseEsid(newMod())
    if (!esid) return
    void props.mod.runBoardAddModerator(esid)
    setNewMod('')
  }

  return (
    <Modal title={t('settings.board.title')} onClose={props.onClose}>
      <Show when={props.canSoft}>
        <div class={sectionVariants()}>
          <div class={labelVariants()}>{t('settings.board.description')}</div>
          <div class={rowVariants()}>
            <Field as="input" grow="min-w-input" value={desc()} onInput={(e) => setDesc(e.currentTarget.value)} />
            <Button disabled={props.mod.busy} onClick={() => void props.mod.runBoardSetDescription(desc())}>
              {t('mod.save')}
            </Button>
          </div>
        </div>
      </Show>

      <Show when={props.canCore}>
        <div class={sectionVariants()}>
          <div class={labelVariants()}>{t('settings.board.maxMedia')}</div>
          <div class={rowVariants()}>
            <Field as="input" type="number" grow="min-w-input" value={maxMedia()} onInput={(e) => setMaxMedia(e.currentTarget.value)} />
            <Button disabled={props.mod.busy} onClick={() => saveNumber(props.mod.runBoardSetMaxMedia)(maxMedia())}>
              {t('mod.save')}
            </Button>
          </div>
        </div>
      </Show>

      <Show when={props.canCore}>
        <div class={sectionVariants()}>
          <div class={labelVariants()}>{t('settings.board.bumpLimit')}</div>
          <div class={rowVariants()}>
            <Field as="input" type="number" grow="min-w-input" value={bumpLimit()} onInput={(e) => setBumpLimit(e.currentTarget.value)} />
            <Button disabled={props.mod.busy} onClick={() => saveNumber(props.mod.runBoardSetBumpLimit)(bumpLimit())}>
              {t('mod.save')}
            </Button>
          </div>
        </div>
      </Show>

      <Show when={props.canCore}>
        <div class={sectionVariants()}>
          <label class={toggleLabelVariants()}>
            <input
              type="checkbox"
              checked={ignoreBans()}
              onChange={(e) => {
                setIgnoreBans(e.currentTarget.checked)
                void props.mod.runBoardSetIgnoreForumBans(e.currentTarget.checked)
              }}
            />
            <span>{t('settings.board.ignoreForumBans')}</span>
          </label>
        </div>
      </Show>

      <Show when={props.canSoft}>
        <div class={sectionVariants()}>
          <div class={labelVariants()}>{t('settings.board.reactions')}</div>
          <div class={rowVariants()}>
            <label>
              <input
                type="file"
                class={hiddenInputVariants()}
                accept="image/png,image/jpeg,image/gif,image/webp"
                disabled={props.mod.busy}
                onChange={(e) => void onReactionFile(e.currentTarget).catch(reportError)}
              />
              <span class={fileLabelVariants()}>{t('settings.board.addReaction')}</span>
            </label>
            <Button disabled={props.mod.busy || reactions().length === 0} onClick={() => void copyReactions()}>
              {t('settings.board.copyReactions')}
            </Button>
            <Button disabled={props.mod.busy} onClick={() => void pasteReactions()}>
              {t('settings.board.pasteReactions')}
            </Button>
            <Button disabled={props.mod.busy} onClick={() => void saveReactions()}>
              {t('mod.save')}
            </Button>
          </div>
          <div class={chipRowVariants()}>
            <For each={reactions()}>
              {(reaction, index) => (
                <div class={chipVariants()}>
                  <img class={chipImgVariants()} src={model.resources.reactions[resourceKey(props.relayUrl, toHex(reaction).replace(/^0x/, ''))]?.preview ?? reactionUrl(props.relayUrl, toHex(reaction))} alt="" />
                  <IconButton
                    size="xs"
                    class={chipRemoveVariants()}
                    disabled={props.mod.busy}
                    onClick={() => setReactions(reactions().filter((_, i) => i !== index()))}
                  >
                    x
                  </IconButton>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <Show when={props.canSoft}>
        <div class={sectionVariants()}>
          <div class={labelVariants()}>{t('settings.board.pinnedThreads')}</div>
          <div class={rowVariants()}>
            <Field
              as="input"
              grow="min-w-input"
              value={newPin()}
              placeholder={t('settings.board.pinnedPlaceholder')}
              onInput={(e) => setNewPin(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addPin()
              }}
            />
            <Button disabled={props.mod.busy} onClick={addPin}>
              {t('settings.board.addPinned')}
            </Button>
            <Button disabled={props.mod.busy || pinned().length === 0} onClick={() => void props.mod.runBoardSetPinned(pinned())}>
              {t('mod.save')}
            </Button>
          </div>
          <div class={listVariants()}>
            <For each={pinned()}>
              {(entry, index) => (
                <div class={listItemVariants()}>
                  <span>#{entry}</span>
                  <button
                    type="button"
                    class={listRemoveVariants()}
                    disabled={props.mod.busy}
                    onClick={() => setPinned(pinned().filter((_, i) => i !== index()))}
                  >
                    x
                  </button>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <Show when={props.canCore}>
        <div class={sectionVariants()}>
          <div class={labelVariants()}>{t('mod.moderators')}</div>
          <div class={rowVariants()}>
            <Field
              as="input"
              grow="min-w-input"
              value={newMod()}
              placeholder={t('settings.addrPlaceholder')}
              onInput={(e) => setNewMod(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addModerator()
              }}
            />
            <Button disabled={props.mod.busy || !parseEsid(newMod())} onClick={addModerator}>
              {t('settings.add')}
            </Button>
          </div>
          <div class={listVariants()}>
            <For each={props.moderators}>
              {(moderator) => (
                <div class={listItemVariants()}>
                  <span>{moderator}</span>
                  <button type="button" class={listRemoveVariants()} disabled={props.mod.busy} onClick={() => void props.mod.runBoardDelModerator(moderator)}>
                    {t('settings.remove')}
                  </button>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </Modal>
  )
}
