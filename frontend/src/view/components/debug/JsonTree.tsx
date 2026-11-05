import { cva } from 'class-variance-authority'
import { For, Show } from 'solid-js'
import { toHex } from '../../../model/content/hex'

const valueVariants = cva('break-all text-secondary')
const contentsVariants = cva('contents')
const rowVariants = cva('whitespace-pre-wrap break-all')
const indexVariants = cva('text-secondary')
const keyVariants = cva('text-accent')

export function JsonTree(props: { data: unknown; depth?: number }) {
  const depth = () => props.depth ?? 0
  const bytes = () => (props.data instanceof Uint8Array ? props.data : null)
  const keys = () => (props.data != null && typeof props.data === 'object' && !Array.isArray(props.data) ? Object.keys(props.data as object).filter((key) => key !== '$kind') : [])
  return (
    <Show when={bytes()} fallback={
      <Show
        when={props.data != null && typeof props.data === 'object'}
        fallback={<span class={valueVariants()}>{props.data == null ? 'null' : String(props.data)}</span>}
      >
        <Show
          when={Array.isArray(props.data)}
          fallback={
            <Show when={keys().length > 0} fallback={<span class={valueVariants()}>{'{ }'}</span>}>
              <span class={contentsVariants()}>
                <For each={keys()}>
                  {(key) => (
                    <div class={rowVariants()} style={{ 'padding-left': `${depth() * 4}px` }}>
                      <span class={keyVariants()}>{key}:</span>{' '}
                      <JsonTree data={(props.data as Record<string, unknown>)[key]} depth={depth() + 1} />
                    </div>
                  )}
                </For>
              </span>
            </Show>
          }
        >
          <Show when={(props.data as unknown[]).length > 0} fallback={<span class={valueVariants()}>[]</span>}>
            <span class={contentsVariants()}>
              <For each={props.data as unknown[]}>
                {(item, index) => (
                  <div class={rowVariants()} style={{ 'padding-left': `${depth() * 4}px` }}>
                    <span class={indexVariants()}>[{index()}]</span> <JsonTree data={item} depth={depth() + 1} />
                  </div>
                )}
              </For>
            </span>
          </Show>
        </Show>
      </Show>
    }>
      {(value) => <span class={valueVariants()}>{value().length === 0 ? '[]' : toHex(value())}</span>}
    </Show>
  )
}
