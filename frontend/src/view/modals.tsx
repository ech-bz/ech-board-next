import { createContext, Show, useContext, type JSX } from 'solid-js'
import type { EntityObject } from '../model/entities/entity'
import type { Post } from '../model/entities/post'
import { identityKey as esidHex } from '../model/rules/identity'
import { canBoardCore, canBoardSettings, canThreadAdminMgmt, roleForForumSettings, type BanScope } from '../model/rules/permissions'
import type { RoleKind, RoleOption } from '../model/rules/roles'
import { useForumController, useForumModel, useForumQueries } from './bindings/forum'
import { BanModal } from './components/BanModal'
import { AuthorHistoryModal } from './components/AuthorHistoryModal'
import { GrantRoleModal } from './components/GrantRoleModal'
import { BansModal } from './components/BansModal'
import { BoardSettingsModal } from './components/BoardSettingsModal'
import { CreateBoardModal } from './components/CreateBoardModal'
import { ForumTitleModal } from './components/ForumTitleModal'
import { LogsModal, type LogsTab } from './components/LogsModal/LogsModal'
import { ModeratorsModal } from './components/ModeratorsModal'
import { ThreadTopicModal } from './components/ThreadTopicModal'
import { TransactionModal } from './components/TransactionModal'
import { UnbanModal } from './components/UnbanModal'
import { useMod } from './mod'

export interface ModalsApi {
  openThreadTopic: (threadId: string) => void
  openThreadModerators: (threadId: string) => void
  openBoardModerators: () => void
  openForumModerators: (forumId: string) => void
  openBoardSettings: () => void
  openBan: (posts: Post[], threadId: string, deletePosts?: boolean) => void
  openBans: (title: string, kind: 'forum' | 'board' | 'thread', id: string, relayUrl?: string) => void
  openTransaction: (txid: string, relayUrl?: string) => void
  openUnban: (postId: string, threadId: string) => void
  openGrantRole: (postId: string, threadId: string) => void
  openLogs: (tab: LogsTab, object?: EntityObject, relayUrl?: string) => void
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
    return target.kind === 'forum' ? read.forumModeratorsOf(target.forumId ?? '') : read.info()?.moderators ?? null
  }
  const banTarget = () => model.dialogs.banTarget
  const bans = () => model.dialogs.bans
  const boardSettings = () => model.dialogs.boardSettings
  const logs = () => model.dialogs.logs
  const roleKinds = (): RoleKind[] => props.roles.map((role) => role.kind)
  const api: ModalsApi = {
    openThreadTopic: controller.openThreadTopic,
    openThreadModerators: (id) => controller.openModerators('thread', id),
    openBoardModerators: () => controller.openModerators('board'),
    openForumModerators: (forumId) => controller.openModerators('forum', undefined, forumId),
    openBoardSettings: controller.openBoardSettings,
    openBan: (posts, threadId, deletePosts) => controller.openBan(posts.map((post) => post.id), threadId, deletePosts),
    openBans: controller.openBans,
    openTransaction: controller.openTransaction,
    openUnban: controller.openUnban,
    openGrantRole: controller.openGrantRole,
    openLogs: controller.openLogs,
  }

  return (
    <ModalsCtx.Provider value={api}>
      {props.children}
      <Show when={model.dialogs.forumTitle} keyed>
        {(dialog) => (
          <ForumTitleModal
            initial={read.forumObjectOf(dialog.forumId)?.title ?? ''}
            busy={mod.busy()}
            allowed={!!roleForForumSettings(read.forumObjectOf(dialog.forumId)?.roles ?? [])}
            onSave={(title) => { void controller.setForumTitle(dialog.forumId, title) }}
            onClose={() => controller.closeDialog('forumTitle')}
          />
        )}
      </Show>
      <Show when={model.dialogs.createBoard} keyed>
        {(dialog) => (
          <CreateBoardModal
            busy={mod.busy()}
            allowed={!!roleForForumSettings(read.forumObjectOf(dialog.forumId)?.roles ?? [])}
            onCreate={(slug, description) => { void controller.createBoard(dialog.forumId, slug, description) }}
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
      <Show when={banTarget()}>
        <BanModal
          roleKinds={roleKinds()}
          busy={mod.busy()}
          onClose={() => controller.closeDialog('banTarget')}
          onBan={async (scope, durationMs, reason) => {
            const target = banTarget()
            if (!target) return
            const posts = target.postIds.flatMap((id) => { const post = read.get(id); return post ? [post] : [] })
            if (posts.length === 1) await mod.runBan(posts[0], target.threadId, scope, durationMs, reason)
            else await mod.runBatchBan(posts, target.threadId, scope, durationMs, reason)
            if (target.deletePosts) {
              if (posts.length === 1) await mod.runPostDelete(posts[0], 'delete', target.threadId)
              else await mod.runBatchPostDelete(posts, target.threadId)
            }
            controller.closeDialog('banTarget')
          }}
        />
      </Show>
      <Show when={bans()}>
        {(value) => <BansModal title={value().title} relayUrl={value().relayUrl ?? props.relayUrl} kind={value().kind} id={value().id} onClose={() => controller.closeDialog('bans')} />}
      </Show>
      <Show when={logs()}>
        {(state) => (
          <LogsModal
            tab={state().tab}
            relayUrl={state().relayUrl ?? props.relayUrl}
            boardId={read.info()?.boardId}
            object={state().object}
            onClose={() => controller.closeDialog('logs')}
          />
        )}
      </Show>
      <Show when={model.dialogs.authorHistory !== null}>
        <AuthorHistoryModal esid={model.dialogs.authorHistory ?? ''} relayUrl={props.relayUrl} onClose={() => controller.closeDialog('authorHistory')} />
      </Show>
      <Show when={model.dialogs.transaction} keyed>
        {(dialog) => (
          <TransactionModal txid={dialog.txid} relayUrl={dialog.relayUrl ?? props.relayUrl} onClose={() => controller.closeDialog('transaction')} />
        )}
      </Show>
      <Show when={model.dialogs.unbanTarget} keyed>
        {(target) => <UnbanModal postId={target.postId} threadId={target.threadId} onClose={() => controller.closeDialog('unbanTarget')} />}
      </Show>
      <Show when={model.dialogs.grantTarget} keyed>
        {(target) => (
          <GrantRoleModal
            postId={target.postId}
            threadId={target.threadId}
            canThread={canThreadAdminMgmt(roleKinds())}
            canBoard={canBoardCore(roleKinds())}
            onClose={() => controller.closeDialog('grantTarget')}
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
            runBoardSetPostRateLimit: (v) => mod.runBoardSetPostRateLimit(v),
            runBoardSetReactionRateLimit: (v) => mod.runBoardSetReactionRateLimit(v),
            runBoardSetPowBits: (v) => mod.runBoardSetPowBits(v),
            runBoardSetIgnoreForumBans: (v) => mod.runBoardSetIgnoreForumBans(v),
            runBoardSetReactions: (vals) => mod.runBoardSetReactions(vals),
            runBoardSetPinned: (pinned) => mod.runBoardSetPinned(pinned),
            runBoardAddModerator: (addr) => mod.runBoardAddModerator(read.info()!.boardId, addr),
            runBoardDelModerator: (addr) => mod.runBoardDelModerator(read.info()!.boardId, addr),
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
