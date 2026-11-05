import { createRoot } from 'solid-js'
import type { Post } from '../model/entities/post'
import { withThreadRoles } from '../model/rules/roles'
import { createQueries } from '../model/selectors/queries'
import { initializeModel } from './bootstrap'
import { createComposerCommands } from './commands/composer'
import { createIdentityCommands } from './commands/identity'
import { createForumCommands } from './commands/forum'
import { createInspectionCommands } from './commands/inspection'
import { createModActions } from './commands/moderation'
import { createNavigation } from './commands/navigation'
import { createOverlayCommands } from './commands/overlays'
import { createPostSubmit } from './commands/posting'
import { createPostCommands } from './commands/posts'
import { createPreferenceCommands } from './commands/preferences'
import { createPreviewCommands } from './commands/previews'
import { createReactionCommands } from './commands/reactions'
import { createSecretCommands } from './commands/secrets'
import { createSelectionCommands } from './commands/selection'
import { createSubmissionCommands } from './commands/submission'
import { createUnreadCommands } from './commands/unread'
import { createModel, type Commit } from './commit'
import { failure } from './errors'
import { createForumGateway } from './forumGateway'
import { createReceiver } from './ingestion/receive'
import { writeClipboard } from './io/browser/clipboard'
import { synchronizeDeadlines } from './synchronization/deadlines'
import { createPostRefresh } from './synchronization/postRefresh'
import { createRealtime } from './synchronization/realtime'

export function createController() {
  return createRoot((disposeRoot) => {
    const { model, commit } = createModel()
    let disposed = false
    const isDisposed = () => disposed
    const write: Commit = (...operations) => { if (!disposed) commit(...operations) }
    const read = createQueries(model)
    const gateway = createForumGateway(model, write)
    const { receive, prepare } = createReceiver(model, write, isDisposed)
    const startup = new AbortController()
    const ready = initializeModel(model, write, gateway, startup.signal).catch((error) => {
      write({ type: 'navigation.patch', value: { loading: false, error: failure(error) } })
    })
    const realtime = createRealtime(model, write, gateway, receive, prepare, isDisposed, () => {
      const route = model.navigation.route
      if (!route) return
      navigation.invalidateRoute()
      void navigation.navigate(route, true)
    })
    const navigation = createNavigation(model, write, gateway, receive, ready, realtime, isDisposed)
    const posts = createPostCommands(model, write, gateway, receive)
    const previews = createPreviewCommands(model, write, gateway, receive, isDisposed)
    const refreshPost = createPostRefresh(posts.refetchPost)
    synchronizeDeadlines(model, write)
    let nextNotification = 1
    const notify = (error: unknown) => write({ type: 'notification.add', value: { id: nextNotification++, message: failure(error) } })
    const inspection = createInspectionCommands(model, write, gateway)
    const secrets = createSecretCommands(model, write)
    const posting = createPostSubmit(model.operations, write, notify)
    const moderation = createModActions(() => {
      const info = read.info()
      if (!info) throw new Error('Forum is unavailable')
      return {
        receive, ...info,
        slug: read.boardObject()?.slug ?? '',
        roles: read.roles(),
        threadNumber: (id: string) => read.threadObject(id)?.number ?? null,
        rolesForThread: (id: string) => withThreadRoles(read.roles(), read.rolesForThread(id)),
        onPostContent: (hash: string, bytes: Uint8Array) => posts.addContent(hash, bytes, info.forumId),
        onPostDone: (post: Post) => refreshPost(post.id, info.forumId),
        onError: notify,
      }
    }, model, write, gateway)
    const composer = createComposerCommands(model, read, write, moderation)
    const { invalidateRoute, ...navigationCommands } = navigation
    const controller = {
      ...navigationCommands,
      ...posts,
      ...previews,
      ...createOverlayCommands(write),
      ...createSubmissionCommands(model, read, gateway, receive, posting, composer),
      ...createReactionCommands(write),
      ...createIdentityCommands(model, write),
      ...createForumCommands(model, write, gateway, receive, notify),
      ...createPreferenceCommands(model, write),
      updateComposerDraft: composer.updateComposerDraft,
      beginPostEdit: composer.beginPostEdit,
      cancelPostEdit: composer.cancelPostEdit,
      submitPostEdit: composer.submitPostEdit,
      copyText: writeClipboard,
      selection: createSelectionCommands(model, read, moderation, write),
      ...createUnreadCommands(model, write),
      loadBans: inspection.loadBans,
      loadSnapshot: inspection.loadSnapshot,
      loadFeed: inspection.loadFeed,
      revealSecret: secrets.revealSecret,
      receiveEvent: realtime.receiveEvent,
      cancelPosting: posting.cancel,
      moderation,
      toggleThreadPin(id: string) {
        const thread = read.threadObject(id)
        if (!thread) return
        const current = read.pinnedNumbers()
        return moderation.runBoardSetPinned(current.includes(thread.number) ? current.filter((value) => value !== thread.number) : [...current, thread.number])
      },
      dispose() {
        if (disposed) return
        disposed = true
        startup.abort()
        inspection.disposeInspection()
        secrets.disposeSecrets()
        posting.cancel()
        navigation.cancelNavigation()
        realtime.client.close()
        disposeRoot()
      },
    }
    return { model, read, commands: controller }
  })
}

export type ForumRuntime = ReturnType<typeof createController>
export type ForumController = ForumRuntime['commands']
