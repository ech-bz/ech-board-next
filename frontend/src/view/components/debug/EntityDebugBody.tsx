import { cva } from 'class-variance-authority'
import { createEffect, Show } from 'solid-js'
import { type EntityObject } from '../../../model/entities/entity'
import { resourceKey } from '../../../model/state/resources'
import { useForumController, useForumModel } from '../../bindings/forum'
import { useI18n } from '../../i18n'
import { FeedView } from './FeedView'
import { JsonTree } from './JsonTree'

const sectionVariants = cva('mb-4')
const hexFieldVariants = cva('w-full overflow-x-auto rounded-md bg-panel2 px-2.5 py-2 font-mono text-sm text-secondary')
const spacerVariants = cva('h-3')
const treeVariants = cva('max-h-debug overflow-y-auto rounded-md bg-panel2 p-2.5 font-mono text-sm leading-normal text-secondary')
const labelVariants = cva('mb-2 font-bold')

export function EntityDebugBody(props: {
  object: EntityObject
  relayUrl: string
}) {
  const { t } = useI18n()
  const controller = useForumController()
  const model = useForumModel()
  const state = () => model.resources.snapshots[resourceKey(props.relayUrl, props.object.kind, props.object.id)]
  const snapshot = () => state()?.data ?? null
  createEffect(() => { void controller.loadSnapshot(props.relayUrl, props.object.kind, props.object.id) })
  return (
    <>
      <div class={sectionVariants()}>
        <Show when={state()?.error}>
          <div class="my-1 text-md text-danger">{String(state()?.error)}</div>
        </Show>
        <Show when={state()?.loading && !snapshot()}>
          <p class="my-1 text-md text-secondary">{t('common.loading')}</p>
        </Show>
        <Show when={snapshot()} keyed>
          {(snapshot) => (
            <>
              <input class={hexFieldVariants()} readOnly value={snapshot.hex} onFocus={(e) => e.currentTarget.select()} />
              <div class={spacerVariants()} />
              <div class={treeVariants()} data-entity-bcs={snapshot.id}>
                <JsonTree data={snapshot.entity} />
              </div>
            </>
          )}
        </Show>
      </div>
      <Show when={snapshot()} keyed>
        {(snapshot) => (
          <div class={sectionVariants()}>
            <div class={labelVariants()}>{t('feed.eventLog')}</div>
            <FeedView
              entityId={snapshot.id}
              relayUrl={props.relayUrl}
            />
          </div>
        )}
      </Show>
    </>
  )
}
