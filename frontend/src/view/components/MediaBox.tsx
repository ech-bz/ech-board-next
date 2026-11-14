import { cva } from 'class-variance-authority'
import { createSignal, Show } from 'solid-js'
import { fromHex } from '../../model/content/hex'
import type { MediaInfo } from '../../model/entities/media'
import type { Post } from '../../model/entities/post'
import { useEntityActions } from '../entityActions'
import { useI18n } from '../i18n'
import { MusicIcon } from '../icons/MusicIcon'
import { SearchIcon } from '../icons/SearchIcon'
import { XIcon } from '../icons/XIcon'
import type { SourceRect } from './Gallery/context'
import { DropdownMenu, type MenuItem } from './Menu/DropdownMenu'

export const mediaCardVariants = cva(
  'group relative flex-none h-media w-media overflow-hidden rounded-md max-[899px]:h-media-mobile max-[899px]:w-media-mobile',
  {
    variants: {
      banned: {
        true: 'cursor-default',
        false: 'cursor-pointer',
      },
      borderedUnbanned: {
        true: 'border border-dashed border-secondary',
      },
    },
  },
)

export const mediaBannedVariants = cva('absolute inset-0 size-full object-cover')
export const mediaThumbBlurVariants = cva('absolute inset-0 size-full scale-[1.15] object-cover blur-[28px]')
export const mediaThumbVariants = cva('absolute inset-0 m-auto h-auto w-auto max-h-full max-w-full')
export const mediaDurationVariants = cva('pointer-events-none absolute right-1.25 top-1.25 rounded-sm bg-shade px-1.5 py-0.5 text-xs leading-snug text-scrim-fg [font-variant-numeric:tabular-nums]')
export const mediaModBtnVariants = cva('absolute left-0 top-0 z-control flex size-4 cursor-pointer items-center justify-center bg-shade opacity-70 text-scrim-fg hover:opacity-100')
export const mediaInfoVariants = cva('pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-shade px-2 py-1.5 text-xs leading-snug opacity-100 transition-opacity duration-150 group-hover:opacity-100 [@media(hover:hover)]:opacity-0 text-scrim-fg')
export const mediaAudioThumbVariants = cva('absolute inset-0 flex items-center justify-center bg-shade text-scrim-fg')
const mediaPdfLabelVariants = cva('text-base font-bold tracking-wide')
export const mediaSearchVariants = cva('absolute right-0 top-0 z-control flex')

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / 1048576).toFixed(1)}MB`
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const MIME_LABELS: Record<string, string> = { 'audio/mpeg': 'MP3' }

export function formatMime(mime: string): string {
  const i = mime.indexOf('/')
  const ext = i >= 0 ? mime.slice(i + 1) : mime
  return MIME_LABELS[mime] ?? ext.toUpperCase()
}

export function MediaBox(props: { m: MediaInfo; post: Post; onOpen: (m: MediaInfo, rect?: SourceRect) => void }) {
  const { t } = useI18n()
  const actions = useEntityActions()
  const [failedThumbnail, setFailedThumbnail] = createSignal<string | null>(null)
  const unavailable = () => props.m.banned || props.m.missing || failedThumbnail() === props.m.thumbUrl
  const isVideo = () => props.m.mime.startsWith('video/')
  const isAudio = () => props.m.mime.startsWith('audio/')
  const isDocument = () => props.m.mime === 'application/pdf'
  const isGif = () => props.m.mime === 'image/gif'
  const isImage = () => props.m.mime.startsWith('image/')
  const thumbnailWidth = () => {
    const { width, height } = props.m
    if (unavailable() || !isImage() && !isVideo() || width <= 0 || height <= 0) return undefined
    return `${Math.max(1, Math.round(Math.min(width, 220, width * 220 / height)))}px`
  }
  const searchItems = (): MenuItem[] =>
    isImage() && !unavailable()
      ? [
        { label: t('media.searchGoogle'), href: `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(props.m.fullUrl)}` },
        { label: t('media.searchYandex'), href: `https://yandex.ru/images/search?rpt=imageview&url=${encodeURIComponent(props.m.fullUrl)}` },
        { label: t('media.searchSaucenao'), href: `https://saucenao.com/search.php?db=999&url=${encodeURIComponent(props.m.fullUrl)}` },
        { label: t('media.searchIqdb'), href: `https://iqdb.org/?url=${encodeURIComponent(props.m.fullUrl)}` },
      ]
      : []
  const banMedia = () => actions.runBanMedia(props.post, props.post.threadId, [fromHex(props.m.hash)])
  const unbanMedia = () => actions.runUnbanMedia(props.post, props.post.threadId, [fromHex(props.m.hash)])
  return (
    <a
      data-media=""
      draggable={false}
      class={mediaCardVariants({ banned: unavailable(), borderedUnbanned: (isVideo() || isGif() || isAudio() || isDocument()) && !unavailable() })}
      href={unavailable() ? undefined : props.m.fullUrl}
      target={isDocument() ? '_blank' : undefined}
      rel={isDocument() ? 'noopener noreferrer' : undefined}
      style={{ '--nat-w': thumbnailWidth() }}
      onClick={(e) => {
        if (unavailable()) {
          e.preventDefault()
          return
        }
        if (isDocument()) return
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        props.onOpen(props.m, { left: rect.left, top: rect.top, width: rect.width, height: rect.height })
      }}
    >
      <Show
        when={!unavailable()}
        fallback={<img class={mediaBannedVariants()} src="/static/banned_media.png" alt="" />}
      >
        <Show
          when={!isAudio() && !isDocument()}
          fallback={
            <div class={mediaAudioThumbVariants()}>
              <Show when={isDocument()} fallback={<MusicIcon width={40} height={40} />}>
                <span class={mediaPdfLabelVariants()}>PDF</span>
              </Show>
            </div>
          }
        >
          <img class={mediaThumbBlurVariants()} src={props.m.thumbUrl} alt="" aria-hidden="true" draggable={false} />
          <img
            class={mediaThumbVariants()}
            src={props.m.thumbUrl}
            alt=""
            onError={() => setFailedThumbnail(props.m.thumbUrl)}
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        </Show>
      </Show>
      <Show when={!unavailable() && (isVideo() || isAudio()) && props.m.durationMs != null}>
        <span class={mediaDurationVariants()}>{formatDuration(props.m.durationMs!)}</span>
      </Show>
      <Show when={!unavailable() && searchItems().length > 0}>
        <div class={mediaSearchVariants()}>
          <DropdownMenu
            icon={<SearchIcon width={12} height={12} />}
            ariaLabel={t('media.searchImage')}
            triggerSize="xs"
            triggerShape="square"
            class="bg-shade opacity-70 hover:opacity-100 [&_svg]:text-scrim-fg"
            items={searchItems()}
          />
        </div>
      </Show>
      <Show when={props.post.canBanMedia && !props.m.banned}>
        <button
          type="button"
          class={mediaModBtnVariants()}
          title={t('mod.banMedia')}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            banMedia()
          }}
        >
          <XIcon width={12} height={12} />
        </button>
      </Show>
      <Show when={props.post.canUnbanMedia && props.m.banned}>
        <button
          type="button"
          class={mediaModBtnVariants()}
          title={t('mod.unbanMedia')}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            unbanMedia()
          }}
        >
          ↺
        </button>
      </Show>
      <Show when={!unavailable()}>
        <div class={mediaInfoVariants()}>
          <span>
            {formatMime(props.m.mime)}
            {isAudio() || isDocument() ? '' : ` ${props.m.width}x${props.m.height}`}
          </span>
          <span>
            {formatSize(props.m.size)}
            {props.m.durationMs != null ? ` ${formatDuration(props.m.durationMs)}` : ''}
          </span>
        </div>
      </Show>
    </a>
  )
}
