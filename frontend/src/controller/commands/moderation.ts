import { blake2b } from '@noble/hashes/blake2'
import { forumKey } from '../../model/selectors/forum'
import { ownIdentities } from '../../model/selectors/identities'
import type { ForumState } from '../../model/state/forum'
import { resourceKey } from '../../model/state/resources'
import type { Commit } from '../commit'
import type { PostPartInput } from '../io/ech/protocol/types'
import { serializePostParts } from '../io/ech/protocol/types'
import type { EntityUpdate } from '../state/entities.types'

import { toHex } from '../../model/content/hex'
import type { Post } from '../../model/entities/post'
import type { BanScope } from '../../model/rules/permissions'
import {
  roleForBan,
  roleForBoardCore,
  roleForBoardSoft,
  roleForPostAction,
  roleForThreadAction,
  SELF_MOD_WINDOW_MS,
} from '../../model/rules/permissions'
import type { RoleOption } from '../../model/rules/roles'
import { roleTweak, signable } from '../../model/rules/roles'
import { finalizeParts, parseBbCode } from '../content/bbcode'
import { makePostResolver } from '../content/postResolver'

import type { ForumGateway } from '../forumGateway'
import { Calls, type Call } from '../io/ech/forumApi'
import { EntityId } from '../io/ech/protocol/entityId'

export interface ModEnv {
  receive: (changes: EntityUpdate) => void
  forumId: string
  relayUrl: string
  boardId: string
  slug: string
  threadNumber: (threadId: string) => number | null
  roles: RoleOption[]
  rolesForThread: (threadId: string) => RoleOption[]
  onPostDone?: (post: Post) => Promise<void> | void
  onPostContent?: (hashHex: string, blob: Uint8Array) => void
  onError: (e: unknown) => void
}

type PostModAction = 'delete' | 'restore'
type ThreadModAction = 'close' | 'open' | 'delete' | 'restore'

const text = new TextEncoder()

function hashOf(value: string): Uint8Array {
  return blake2b(text.encode(value), { dkLen: 32 })
}

function senderEsid(post: Post): string {
  if (post.author === null) throw new Error('post has no identity')
  return post.author
}

function postNumber(post: Post): number {
  return post.number
}

export function createModActions(getEnv: () => ModEnv, model: ForumState, commit: Commit, gateway: ForumGateway) {
  const busy = () => model.operations.moderating
  const setBusy = (moderating: boolean) => commit({ type: 'operations.patch', value: { moderating } })

  const runAction = async (fn: () => Promise<void>, done?: (env: ModEnv) => Promise<void> | void) => {
    if (busy()) return
    const env = getEnv()
    setBusy(true)
    try {
      await fn()
      await done?.(env)
    } catch (error) {
      env.onError(error)
    }
    setBusy(false)
  }

  const roleForPost = (post: Post, env: ModEnv, action: 'edit' | 'delete' | 'restore' | 'ban_media' | 'unban_media'): RoleOption => {
    const scope = model.scopes[forumKey(env.forumId)]
    const restored = scope ? ownIdentities(scope).find((identity) => identity.esidHex === post.author) : undefined
    const ageMs = Date.now() - post.createdAt
    if (restored && ageMs <= SELF_MOD_WINDOW_MS) {
      return { kind: 'author', labelKey: 'roles.author', esidHex: restored.esidHex, tweak: restored.tweak }
    }
    const role = roleForPostAction(action, env.roles)
    if (!signable(role)) throw new Error('no role for post action')
    return role
  }

  const submit = async (env: ModEnv, role: RoleOption, call: Call, blobs: { hash: string; bytes: Uint8Array }[] = []) => {
    const api = await gateway.connect(env.relayUrl)
    await api.append(call, blobs, roleTweak(role))
  }

  const threadNumberOf = (env: ModEnv, threadId: string): number => {
    const value = env.threadNumber(threadId)
    if (value === null) throw new Error('thread is not loaded')
    return value
  }

  const postId = (env: ModEnv, _threadId: string, post: Post): string =>
    EntityId.post(env.slug, postNumber(post))

  const runPostDelete = (post: Post, action: PostModAction, threadId: string) =>
    runAction(async () => {
      const env = getEnv()
      const role = roleForPost(post, env, action)
      await submit(env, role, Calls.post.set_deleted(postId(env, threadId, post), action === 'delete'))
    })

  const runPostEdit = async (
    post: Post,
    threadId: string,
    value: string,
    secretRefs?: Map<number, PostPartInput>,
  ) => {
    let saved = false
    await runAction(
      async () => {
        const env = getEnv()
        const role = roleForPost(post, env, 'edit')
        const parsed = await parseBbCode(
          value,
          makePostResolver({ model, gateway, forumId: env.forumId, boardId: env.boardId, slug: env.slug, relayUrl: env.relayUrl, receive: env.receive }),
        )
        const api = await gateway.connect(env.relayUrl)
        const secret = api.identity.secret(api.root, roleTweak(role))
        const parts = await finalizeParts(parsed, secret, secretRefs)
        const blob = parts.length > 0 ? serializePostParts(parts) : null
        const hash = blob ? toHex(blake2b(blob, { dkLen: 32 })) : null
        await api.append(
          Calls.post.set_text(postId(env, threadId, post), hash),
          blob && hash ? [{ hash, bytes: blob }] : [],
          roleTweak(role),
        )
        if (blob && hash) env.onPostContent?.(hash, blob)
        saved = true
      },
      (env) => env.onPostDone?.(post),
    )
    return saved
  }

  const runPostBanMedia = (post: Post, threadId: string, hashes: Uint8Array[]) =>
    runAction(
      async () => {
        const env = getEnv()
        const role = roleForPost(post, env, 'ban_media')
        await submit(env, role, Calls.post.ban_media(postId(env, threadId, post), hashes.map(toHex)))
      },
      (env) => env.onPostDone?.(post),
    )

  const runPostUnbanMedia = (post: Post, threadId: string, hashes: Uint8Array[]) =>
    runAction(
      async () => {
        const env = getEnv()
        const role = roleForPost(post, env, 'unban_media')
        await submit(env, role, Calls.post.unban_media(postId(env, threadId, post), hashes.map(toHex)))
      },
      (env) => env.onPostDone?.(post),
    )

  const banTarget = (env: ModEnv, scope: BanScope, threadId: string, _role: RoleOption, target: string, durationMs: number, reason: string) =>
    scope === 'forum'
      ? Calls.forum.ban(target, reason ? toHex(hashOf(reason)) : null, expiresOf(durationMs))
      : scope === 'board'
        ? Calls.board.ban(env.boardId, target, reason ? toHex(hashOf(reason)) : null, expiresOf(durationMs))
        : Calls.thread.ban(threadId, target, reason ? toHex(hashOf(reason)) : null, expiresOf(durationMs))

  function expiresOf(durationMs: number): bigint {
    return durationMs > 0 ? BigInt(Date.now() + durationMs) : 0n
  }

  const runBan = (post: Post, threadId: string, scope: BanScope, _mask: number, durationMs: number, reason: string) =>
    runAction(
      async () => {
        const env = getEnv()
        const role = roleForBan(scope, env.roles)
        if (!signable(role)) throw new Error(`no role for ${scope} ban`)
        await submit(env, role, banTarget(env, scope, threadId, role, senderEsid(post), durationMs, reason))
      },
      (env) => env.onPostDone?.(post),
    )

  const runBanId = (target: string, threadId: string, scope: BanScope, _mask: number, durationMs: number, reason: string) =>
    runAction(async () => {
      const env = getEnv()
      const role = roleForBan(scope, env.roles)
      if (!signable(role)) throw new Error(`no role for ${scope} ban`)
      await submit(env, role, banTarget(env, scope, threadId, role, target.replace(/^0x/, ''), durationMs, reason))
    })

  const runUnban = (post: Post, threadId: string, scope: BanScope) =>
    runAction(
      async () => {
        const env = getEnv()
        const role = roleForBan(scope, env.roles)
        if (!signable(role)) throw new Error(`no role for ${scope} unban`)
        const target = senderEsid(post)
        const call =
          scope === 'forum'
            ? Calls.forum.unban(target)
            : scope === 'board'
              ? Calls.board.unban(env.boardId, target)
              : Calls.thread.unban(threadId, target)
        await submit(env, role, call)
      },
      (env) => env.onPostDone?.(post),
    )

  const batch = async (
    posts: Post[],
    _threadId: string,
    onProgress: ((done: number, total: number) => void) | undefined,
    call: (post: Post) => Call,
    role: RoleOption | null,
  ) => {
    const env = getEnv()
    if (!signable(role)) throw new Error('no role for batch action')
    let done = 0
    for (const post of posts) {
      await submit(env, role, call(post))
      done += 1
      onProgress?.(done, posts.length)
    }
  }

  const runBatchPostDelete = (posts: Post[], threadId: string, onProgress?: (done: number, total: number) => void) => {
    const env = getEnv()
    const targets = posts.filter((post) => !post.deleted)
    threadNumberOf(env, threadId)
    return batch(
      targets,
      threadId,
      onProgress,
      (post) => Calls.post.set_deleted(postId(env, threadId, post), true),
      roleForPostAction('delete', env.roles),
    )
  }

  const runBatchPostRestore = (posts: Post[], threadId: string, onProgress?: (done: number, total: number) => void) => {
    const env = getEnv()
    const targets = posts.filter((post) => post.deleted)
    threadNumberOf(env, threadId)
    return batch(
      targets,
      threadId,
      onProgress,
      (post) => Calls.post.set_deleted(postId(env, threadId, post), false),
      roleForPostAction('restore', env.roles),
    )
  }

  const runBatchBan = (
    posts: Post[],
    threadId: string,
    scope: BanScope,
    _mask: number,
    durationMs: number,
    reason: string,
    onProgress?: (done: number, total: number) => void,
  ) => {
    const env = getEnv()
    const role = roleForBan(scope, env.roles)
    const seen = new Set<string>()
    const targets = posts.filter((post) => {
      const target = post.author
      if (target === null || seen.has(target)) return false
      seen.add(target)
      return true
    })
    return batch(
      targets,
      threadId,
      onProgress,
      (post) => banTarget(env, scope, threadId, role!, senderEsid(post), durationMs, reason),
      role,
    )
  }

  const threadCall = (_env: ModEnv, threadId: string, action: ThreadModAction) =>
    action === 'close'
      ? Calls.thread.set_closed(threadId, true)
      : action === 'open'
        ? Calls.thread.set_closed(threadId, false)
        : Calls.thread.set_deleted(threadId, action === 'delete')

  const runThreadAction = (action: ThreadModAction, threadId: string) =>
    runAction(async () => {
      const env = getEnv()
      const role = roleForThreadAction(action, env.rolesForThread(threadId))
      if (!signable(role)) throw new Error(`no role for ${action}`)
      await submit(env, role, threadCall(env, threadId, action))
    })

  const runThreadCloseDelete = (threadId: string) =>
    runAction(async () => {
      const env = getEnv()
      const role = roleForThreadAction('delete', env.rolesForThread(threadId))
      if (!signable(role)) throw new Error('no role for close/delete')
      await submit(env, role, threadCall(env, threadId, 'close'))
      await submit(env, role, threadCall(env, threadId, 'delete'))
    })

  const runThreadEditTopic = (threadId: string, topic: string) =>
    runAction(async () => {
      const env = getEnv()
      const role = roleForThreadAction('edit_topic', env.rolesForThread(threadId))
      if (!signable(role)) throw new Error('no role for edit_topic')
      const value = topic.trim()
      const hash = value ? toHex(hashOf(value)) : null
      await submit(env, role, Calls.thread.set_topic(threadId, hash), hash ? [{ hash, bytes: text.encode(value) }] : [])
      if (hash) env.onPostContent?.(hash, text.encode(value))
    })

  const runBoardSetDescription = (value: string) =>
    runAction(async () => {
      const env = getEnv()
      const role = roleForBoardSoft(env.roles)
      if (!signable(role)) throw new Error('no role for board settings')
      const hash = value ? toHex(hashOf(value)) : null
      await submit(env, role, Calls.board.set_description(env.boardId, hash), hash ? [{ hash, bytes: text.encode(value) }] : [])
      if (hash) env.onPostContent?.(hash, text.encode(value))
    })

  const boardSetting = (call: (env: ModEnv) => Call, role: RoleOption | null) =>
    runAction(async () => {
      const env = getEnv()
      if (!signable(role)) throw new Error('no role for board settings')
      await submit(env, role, call(env))
    })

  const runBoardSetMaxMedia = (value: number) =>
    boardSetting((env) => Calls.board.set_max_media(env.boardId, value), roleForBoardCore(getEnv().roles))

  const runBoardSetBumpLimit = (value: number) =>
    boardSetting((env) => Calls.board.set_bump_limit(env.boardId, value), roleForBoardCore(getEnv().roles))

  const runBoardSetIgnoreForumBans = (value: boolean) =>
    boardSetting((env) => Calls.board.set_ignore_forum_bans(env.boardId, value), roleForBoardCore(getEnv().roles))

  const runBoardSetReactions = (values: Uint8Array[]) =>
    runAction(async () => {
      const env = getEnv()
      const role = roleForBoardSoft(env.roles)
      if (!signable(role)) throw new Error('no role for board settings')
      const hashes = values.map(toHex)
      const api = await gateway.connect(env.relayUrl)
      const keys = hashes.map((hash) => resourceKey(env.relayUrl, hash.replace(/^0x/, '')))
      const uploads = keys.flatMap((key, index) => {
        const bytes = model.resources.reactions[key]?.bytes
        return bytes ? [{ hash: hashes[index], bytes }] : []
      })
      await api.append(Calls.board.set_reactions(env.boardId, hashes), uploads, roleTweak(role))
      commit({ type: 'reactionUpload.release', value: keys })
    })

  const runBoardSetPinned = (pinned: number[]) =>
    runAction(async () => {
      const env = getEnv()
      const role = roleForBoardSoft(env.roles)
      if (!signable(role)) throw new Error('no role for board settings')
      await submit(env, role, Calls.board.set_pinned(env.boardId, pinned))
    })

  const runBoardAddModerator = (target: string) =>
    boardSetting((env) => Calls.board.add_moderator(env.boardId, target.replace(/^0x/, '')), roleForBoardCore(getEnv().roles))

  const runBoardDelModerator = (target: string) =>
    boardSetting((env) => Calls.board.remove_moderator(env.boardId, target.replace(/^0x/, '')), roleForBoardCore(getEnv().roles))

  const runBoardClose = (value: boolean) =>
    boardSetting((env) => Calls.board.set_readonly(env.boardId, value), roleForBoardCore(getEnv().roles))

  const runThreadSetAdmin = (threadId: string, target: string | null) =>
    runAction(async () => {
      const env = getEnv()
      const role = roleForThreadAction('edit_topic', env.rolesForThread(threadId))
      if (!signable(role)) throw new Error('no role for thread admin')
      await submit(env, role, Calls.thread.set_admin(threadId, target))
    })

  const runThreadAddModerator = (threadId: string, target: string) =>
    runAction(async () => {
      const env = getEnv()
      const role = roleForThreadAction('edit_topic', env.rolesForThread(threadId))
      if (!signable(role)) throw new Error('no role for thread moderators')
      await submit(env, role, Calls.thread.add_moderator(threadId, target))
    })

  const runThreadDelModerator = (threadId: string, target: string) =>
    runAction(async () => {
      const env = getEnv()
      const role = roleForThreadAction('edit_topic', env.rolesForThread(threadId))
      if (!signable(role)) throw new Error('no role for thread moderators')
      await submit(env, role, Calls.thread.remove_moderator(threadId, target))
    })

  return {
    runPostDelete,
    runPostEdit,
    runPostBanMedia,
    runPostUnbanMedia,
    runThreadAction,
    runThreadCloseDelete,
    runThreadEditTopic,
    runBan,
    runBanId,
    runUnban,
    runBatchPostDelete,
    runBatchPostRestore,
    runBatchBan,
    runBoardSetDescription,
    runBoardSetMaxMedia,
    runBoardSetBumpLimit,
    runBoardSetIgnoreForumBans,
    runBoardSetReactions,
    runBoardSetPinned,
    runBoardAddModerator,
    runBoardDelModerator,
    runBoardClose,
    runThreadSetAdmin,
    runThreadAddModerator,
    runThreadDelModerator,
  }
}

export type ModActions = ReturnType<typeof createModActions>
