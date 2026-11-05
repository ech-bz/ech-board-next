import type { Identity } from '../entities/identity'
import { identityKey } from './identity'

type RoleLabel = 'roles.anonymous' | 'roles.author' | 'roles.op' | 'roles.forumMod' | 'roles.boardMod' | 'roles.threadMod' | 'roles.threadAdmin'

export type RoleKind =
  | 'anonymous'
  | 'author'
  | 'op'
  | 'forum_mod'
  | 'board_mod'
  | 'thread_mod'
  | 'thread_admin'

export interface RoleOption {
  kind: RoleKind
  labelKey: RoleLabel
  esidHex?: string
  tweak?: Uint8Array
  selectable?: boolean
}

export function signable(role?: RoleOption | null): role is RoleOption {
  return !!role && !!role.tweak
}

export function roleTweak(role: RoleOption): Uint8Array {
  if (role.tweak) return role.tweak
  throw new Error('role has no identity')
}

export interface Moderators {
  forum_mods: Identity[]
  board_mods: Identity[]
  thread_mods: Identity[]
  thread_admin: Identity | null
}

export function moderatorsOf(value: {
  forum_mods: Identity[]
  board_mods: Identity[]
  thread_mods: Identity[]
  thread_admin: Identity | null
}): Moderators {
  return {
    forum_mods: value.forum_mods,
    board_mods: value.board_mods,
    thread_mods: value.thread_mods,
    thread_admin: value.thread_admin,
  }
}

export interface RoleContext {
  mine: { tweak: Uint8Array; esidHex: string }[]
  moderators: Moderators
  op?: { tweak: Uint8Array; esidHex: string } | null
}

const clean = (value: string) => value.replace(/^0x/, '').toLowerCase()

function findRole(
  mine: { tweak: Uint8Array; esidHex: string }[],
  list: Identity[],
): { tweak: Uint8Array; esidHex: string } | null {
  for (const item of mine) {
    if (list.some((esid) => clean(identityKey(esid)) === clean(item.esidHex))) return item
  }
  return null
}

export function detectRoles(ctx: RoleContext): RoleOption[] {
  const roles: RoleOption[] = [{ kind: 'anonymous', labelKey: 'roles.anonymous' }]
  const forum = findRole(ctx.mine, ctx.moderators.forum_mods)
  if (forum) roles.push({ kind: 'forum_mod', labelKey: 'roles.forumMod', esidHex: forum.esidHex, tweak: forum.tweak })
  const board = findRole(ctx.mine, ctx.moderators.board_mods)
  if (board) roles.push({ kind: 'board_mod', labelKey: 'roles.boardMod', esidHex: board.esidHex, tweak: board.tweak })
  const thread = findRole(ctx.mine, ctx.moderators.thread_mods)
  if (thread) roles.push({ kind: 'thread_mod', labelKey: 'roles.threadMod', esidHex: thread.esidHex, tweak: thread.tweak })
  if (ctx.moderators.thread_admin) {
    const admin = ctx.mine.find(
      (item) => clean(item.esidHex) === clean(identityKey(ctx.moderators.thread_admin!)),
    )
    if (admin) roles.push({ kind: 'thread_admin', labelKey: 'roles.threadAdmin', esidHex: admin.esidHex, tweak: admin.tweak })
  }
  if (ctx.op) {
    roles.push({ kind: 'op', labelKey: 'roles.op', esidHex: ctx.op.esidHex, tweak: ctx.op.tweak })
  }
  return roles
}

export function withThreadRoles(viewRoles: RoleOption[], threadRoles: RoleOption[]): RoleOption[] {
  return [
    ...viewRoles.filter((role) => role.kind !== 'thread_admin' && role.kind !== 'thread_mod'),
    ...threadRoles,
  ]
}

export type PostRole = 'op' | 'mop' | 'thread_mod' | 'thread_admin' | 'board_mod' | 'forum_mod' | null

export function postRole(addr: string, mods: Moderators, opEsid: string | null): PostRole {
  if (opEsid !== null && clean(addr) === clean(opEsid)) {
    return mods.thread_admin && clean(identityKey(mods.thread_admin)) === clean(addr) ? 'mop' : 'op'
  }
  return roleForAddress(addr, mods)
}

export function roleForAddress(addr: string, mods: Moderators): PostRole {
  const hex = clean(addr)
  if (mods.thread_admin && clean(identityKey(mods.thread_admin)) === hex) return 'thread_admin'
  const inList = (list: Identity[]) => list.some((esid) => clean(identityKey(esid)) === hex)
  if (inList(mods.thread_mods)) return 'thread_mod'
  if (inList(mods.board_mods)) return 'board_mod'
  if (inList(mods.forum_mods)) return 'forum_mod'
  return null
}
