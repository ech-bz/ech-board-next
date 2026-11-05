import { Show } from 'solid-js'
import { useForumQueries } from '../../bindings/forum'
import { EntityDebugBody } from '../debug/EntityDebugBody'

export function ForumTab(props: { relayUrl: string }) {
  const read = useForumQueries()
  const forum = () => read.forumEntityId(props.relayUrl)
  return <Show when={forum()}>{(id) => <EntityDebugBody object={{ kind: 'forum', id: id() }} relayUrl={props.relayUrl} />}</Show>
}
