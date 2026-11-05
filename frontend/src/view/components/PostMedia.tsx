import { cva } from 'class-variance-authority'
import { For, Show } from 'solid-js'
import type { MediaInfo } from '../../model/entities/media'
import type { Post } from '../../model/entities/post'
import { createMediaStrip } from '../interactions/mediaStrip'
import type { SourceRect } from './Gallery/context'
import { MediaBox } from './MediaBox'

const mediaWrapVariants = cva('mb-2')
const mediaRowVariants = cva('flex select-none items-center gap-1 overflow-x-auto [overscroll-behavior-x:contain] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', {
  variants: {
    dragging: {
      true: '[&_*]:cursor-grabbing',
    },
  },
})
const mediaTrackVariants = cva('mt-1.5 h-1 w-full rounded-sm bg-chip')
const mediaThumbVariants = cva('relative h-1 rounded-sm bg-toggle-track transition-colors duration-150 hover:bg-track before:absolute before:-inset-y-1 before:inset-x-0 before:content-[""]')

export function PostMedia(props: { post: Post; onOpen: (media: MediaInfo, rect?: SourceRect) => void }) {
  const { setMediaEl, mediaDragging, mediaMask, mediaThumbGeom, onMediaPointerDown, onMediaPointerMove, onMediaPointerUp, onThumbPointerDown, onThumbPointerMove, onThumbPointerUp } = createMediaStrip()
  return (
    <div class={mediaWrapVariants()}>
      <div
        ref={setMediaEl}
        data-media-row=""
        class={mediaRowVariants({ dragging: mediaDragging() })}
        style={{ 'mask-image': mediaMask(), '-webkit-mask-image': mediaMask() }}
        onPointerDown={onMediaPointerDown}
        onPointerMove={onMediaPointerMove}
        onPointerUp={onMediaPointerUp}
        onPointerCancel={onMediaPointerUp}
      >
        <For each={props.post.media}>{(item) => <MediaBox m={item} post={props.post} onOpen={props.onOpen} />}</For>
      </div>
      <Show when={mediaThumbGeom()}>
        {(geom) => (
          <div class={mediaTrackVariants()}>
            <div
              class={mediaThumbVariants()}
              style={{ width: `${geom().width}px`, transform: `translateX(${geom().x}px)` }}
              onPointerDown={onThumbPointerDown}
              onPointerMove={onThumbPointerMove}
              onPointerUp={onThumbPointerUp}
              onPointerCancel={onThumbPointerUp}
            />
          </div>
        )}
      </Show>
    </div>
  )
}
