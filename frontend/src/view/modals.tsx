import { createContext, Show, useContext, type JSX } from 'solid-js'
import type { EntityObject } from '../model/entities/entity'
import type { Post } from '../model/entities/post'
import { identityKey as esidHex } from '../model/rules/identity'
import { canBoardCore, canBoardSettings, roleForForumSettings, type BanScope } from '../model/rules/permissions'
import type { RoleKind, RoleOption } from '../model/rules/roles'
import { useForumController, useForumModel, useForumQueries } from './bindings/forum'
import { BanModal } from './components/BanModal'
import { BansModal } from './components/BansModal'
import { BoardSettingsModal } from './components/BoardSettingsModal'
import { CreateBoardModal } from './components/CreateBoardModal'
import { ForumTitleModal } from './components/ForumTitleModal'
import { LogsModal, type LogsTab } from './components/LogsModal/LogsModal'
import { ModeratorsModal } from './components/ModeratorsModal'
import { ThreadTopicModal } from './components/ThreadTopicModal'
import { useMod } from './mod'

export interface ModalsApi {
  openThreadTopic: (threadId: string) => void
  openThreadModerators: (threadId: string) => void
  openBoardModerators: () => void
  openForumModerators: () => void
  openBoardSettings: () => void
  openBan: (posts: Post[], threadId: string, deletePosts?: boolean) => void
  openBanId: () => void
  openBans: (title: string, kind: 'forum' | 'board' | 'thread', id: string) => void
  openLogs: (tab: LogsTab, object?: EntityObject) => void
}

const ModalsCtx = createContext<ModalsApi>()

export function ModalsProvider(props: { roles: RoleOption[]; relayUrl: string; children: JSX.Element }) {
  const read = useForumQueries()
  const mod = useMod()
  const model = useForumModel()
  const controller = useForumController()
  const topic = () => model.dialogs.topic
  const moderators = () => {
    const target = model.dialogs.moderators
    if (!target) return null
    if (target.kind === 'thread') return read.moderatorsOf(target.threadId!)
    return target.kind === 'forum' ? read.forumModerators() : read.info()?.moderators ?? null
  }
  const banTarget = () => model.dialogs.banTarget
  const banIdOpen = () => model.dialogs.banId
  const bans = () => model.dialogs.bans
  const boardSettings = () => model.dialogs.boardSettings
  const logs = () => model.dialogs.logs
  const roleKinds = (): RoleKind[] => props.roles.map((role) => role.kind)
  const api: ModalsApi = {
    openThreadTopic: controller.openThreadTopic,
    openThreadModerators: (id) => controller.openModerators('thread', id),
    openBoardModerators: () => controller.openModerators('board'),
    openForumModerators: () => controller.openModerators('forum'),
    openBoardSettings: controller.openBoardSettings,
    openBan: (posts, threadId, deletePosts) => controller.openBan(posts.map((post) => post.id), threadId, deletePosts),
    openBanId: controller.openBanId,
    openBans: controller.openBans,
    openLogs: controller.openLogs,
  }

  return (
    <ModalsCtx.Provider value={api}>
      {props.children}
      <Show when={model.dialogs.forumTitle} keyed>
        {(forumId) => (
          <ForumTitleModal
            initial={read.forumObject()?.title ?? ''}
            busy={mod.busy()}
            allowed={!!roleForForumSettings(props.roles)}
            onSave={(title) => { void controller.setForumTitle(forumId, title) }}
            onClose={() => controller.closeDialog('forumTitle')}
          />
        )}
      </Show>
      <Show when={model.dialogs.createBoard} keyed>
        {(forumId) => (
          <CreateBoardModal
            busy={mod.busy()}
            allowed={!!roleForForumSettings(props.roles)}
            onCreate={(slug, description) => { void controller.createBoard(forumId, slug, description) }}
            onClose={() => controller.closeDialog('createBoard')}
          />
        )}
      </Show>
      <Show when={topic()}>
        {(state) => (
          <ThreadTopicModal
            threadId={state()}
            initial={read.threadTopic(state())}
            busy={mod.busy()}
            onClose={() => controller.closeDialog('topic')}
            onSave={async (threadId, text) => {
              await mod.runThreadEditTopic(threadId, text)
              controller.closeDialog('topic')
            }}
          />
        )}
      </Show>
      <Show when={moderators()}>
        {(value) => <ModeratorsModal moderators={value()} onClose={() => controller.closeDialog('moderators')} />}
      </Show>
      <Show when={banTarget() || banIdOpen()}>
        <BanModal
          mode={banIdOpen() ? 'id' : 'post'}
          roleKinds={roleKinds()}
          busy={mod.busy()}
          onClose={() => {
            controller.closeDialog('banTarget')
            controller.closeDialog('banId')
          }}
          onBan={async (scope, mask, durationMs, reason, idHex) => {
            if (idHex != null) {
              const threadId = read.threadId()
              await mod.runBanId(idHex, scope === 'thread' ? (threadId ?? '') : '', scope as BanScope, mask, durationMs, reason)
              controller.closeDialog('banId')
              return
            }
            const target = banTarget()
            if (!target) return
            const posts = target.postIds.flatMap((id) => { const post = read.get(id); return post ? [post] : [] })
            if (posts.length === 1) await mod.runBan(posts[0], target.threadId, scope, mask, durationMs, reason)
            else await mod.runBatchBan(posts, target.threadId, scope, mask, durationMs, reason)
            if (target.deletePosts) {
              if (posts.length === 1) await mod.runPostDelete(posts[0], 'delete', target.threadId)
              else await mod.runBatchPostDelete(posts, target.threadId)
            }
            controller.closeDialog('banTarget')
          }}
        />
      </Show>
      <Show when={bans()}>
        {(value) => <BansModal title={value().title} relayUrl={props.relayUrl} kind={value().kind} id={value().id} onClose={() => controller.closeDialog('bans')} />}
      </Show>
      <Show when={logs()}>
        {(state) => (
          <LogsModal
            tab={state().tab}
            relayUrl={props.relayUrl}
            boardId={read.info()?.boardId}
            object={state().object}
            onClose={() => controller.closeDialog('logs')}
          />
        )}
      </Show>
      <Show when={boardSettings() && read.boardObject() && read.info()}>
        <BoardSettingsModal
          onClose={() => controller.closeDialog('boardSettings')}
          board={read.boardObject()!}
          description={read.boardInfo()?.description ?? ''}
          moderators={read.moderatorsOf(read.threadId() ?? '').board_mods.map(esidHex)}
          relayUrl={read.info()!.relayUrl}
          boardId={read.info()!.boardId}
          canCore={canBoardCore(roleKinds())}
          canSoft={canBoardSettings(roleKinds())}
          mod={{
            busy: mod.busy(),
            runBoardSetDescription: (text) => mod.runBoardSetDescription(text),
            runBoardSetMaxMedia: (v) => mod.runBoardSetMaxMedia(v),
            runBoardSetBumpLimit: (v) => mod.runBoardSetBumpLimit(v),
            runBoardSetIgnoreForumBans: (v) => mod.runBoardSetIgnoreForumBans(v),
            runBoardSetReactions: (vals) => mod.runBoardSetReactions(vals),
            runBoardSetPinned: (pinned) => mod.runBoardSetPinned(pinned),
            runBoardAddModerator: (addr) => mod.runBoardAddModerator(addr),
            runBoardDelModerator: (addr) => mod.runBoardDelModerator(addr),
          }}
        />
      </Show>
    </ModalsCtx.Provider>
  )
}

export function useModals(): ModalsApi {
  const value = useContext(ModalsCtx)
  if (!value) throw new Error('useModals outside provider')
  return value
}
