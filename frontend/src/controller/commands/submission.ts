import { createComposerCommands } from '../commands/composer'
import { createPostSubmit } from '../commands/posting'
import { composerForm } from '../commands/submitPost'

import type { ForumQueries } from '../../model/selectors/queries'
import type { ForumState } from '../../model/state/forum'
import type { ForumGateway } from '../forumGateway'
import type { Receive } from '../ingestion/receive'

export function createSubmissionCommands(model: ForumState, read: ForumQueries, gateway: ForumGateway, receive: Receive, posting: ReturnType<typeof createPostSubmit>, composer: ReturnType<typeof createComposerCommands>) {
  return {
    async submitReply(slug: string) {
      const info = read.info(), threadId = read.threadId(), threadNumber = read.threadNumber()
      if (!info || !threadId || threadNumber === null) return null
      const draft = model.drafts.reply
      const revision = draft.revision
      const result = await posting.createReply({ gateway, model, ...info, slug, threadId, threadNumber, role: read.roles().find((role) => role.kind === draft.sendAsKind), receive }, composerForm(draft))
      if (result) composer.complete('reply', revision)
      return result
    },
    async submitThread(slug: string) {
      const info = read.info()
      if (!info) return null
      const draft = model.drafts.thread
      const revision = draft.revision
      const result = await posting.createThread({ gateway, model, ...info, slug, role: read.roles().find((role) => role.kind === draft.sendAsKind), receive }, composerForm(draft), draft.subject)
      if (result) composer.complete('thread', revision)
      return result ? { thread: result.thread, forumId: info.forumId, slug } : null
    }
  }
}
