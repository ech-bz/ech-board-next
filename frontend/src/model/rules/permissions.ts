import { signable, type RoleKind, type RoleOption } from './roles'

export type PostAction = 'delete' | 'restore' | 'edit' | 'ban_media' | 'unban_media'
export type ThreadAction = 'close' | 'open' | 'delete' | 'restore' | 'pin' | 'unpin' | 'edit_topic'

export const SELF_MOD_WINDOW_MS = 600000

const POST_ACTION_ROLES: Record<PostAction, RoleKind[]> = {
  delete: ['forum_mod', 'board_mod', 'thread_admin', 'thread_mod'],
  restore: ['forum_mod', 'board_mod', 'thread_admin', 'thread_mod'],
  edit: ['forum_mod', 'board_mod', 'thread_admin', 'thread_mod'],
  ban_media: ['forum_mod', 'board_mod', 'thread_admin', 'thread_mod'],
  unban_media: ['forum_mod', 'board_mod', 'thread_admin', 'thread_mod'],
}

const THREAD_ACTION_ROLES: Record<ThreadAction, RoleKind[]> = {
  close: ['forum_mod', 'board_mod', 'thread_admin', 'thread_mod'],
  open: ['forum_mod', 'board_mod', 'thread_admin', 'thread_mod'],
  delete: ['forum_mod', 'board_mod', 'thread_admin', 'thread_mod'],
  restore: ['forum_mod', 'board_mod', 'thread_admin', 'thread_mod'],
  edit_topic: ['forum_mod', 'board_mod', 'thread_admin', 'thread_mod'],
  pin: ['forum_mod', 'board_mod'],
  unpin: ['forum_mod', 'board_mod'],
}

function hasRole(roles: RoleKind[], allowed: RoleKind[]): boolean {
  return roles.some(r => allowed.includes(r))
}

export function canPostAction(action: PostAction, roles: RoleKind[], authorAllowed: boolean): boolean {
  if (authorAllowed) return true
  return hasRole(roles, POST_ACTION_ROLES[action])
}

export function canUnbanMedia(roles: RoleKind[]): boolean {
  return hasRole(roles, POST_ACTION_ROLES.unban_media)
}

export function canSelectAllFromAuthor(_roles: RoleKind[]): boolean {
  return false
}

export function canBanById(_roles: RoleKind[]): boolean {
  return false
}

export function roleForPostAction(action: PostAction, options: RoleOption[]): RoleOption | null {
  const allowed = POST_ACTION_ROLES[action]
  return options.find(o => allowed.includes(o.kind) && signable(o)) ?? null
}

export function roleForThreadAction(action: ThreadAction, options: RoleOption[]): RoleOption | null {
  const allowed = THREAD_ACTION_ROLES[action]
  return options.find(o => allowed.includes(o.kind) && signable(o)) ?? null
}

export type BanScope = 'forum' | 'board' | 'thread'

const BAN_SCOPE_ROLES: Record<BanScope, RoleKind[]> = {
  forum: ['forum_mod'],
  board: ['forum_mod', 'board_mod'],
  thread: ['forum_mod', 'board_mod', 'thread_admin', 'thread_mod'],
}

export function canBan(scope: BanScope, roles: RoleKind[]): boolean {
  return hasRole(roles, BAN_SCOPE_ROLES[scope])
}

export function roleForBan(scope: BanScope, options: RoleOption[]): RoleOption | null {
  const allowed = BAN_SCOPE_ROLES[scope]
  return options.find(o => allowed.includes(o.kind) && signable(o)) ?? null
}

export function canBanAny(roles: RoleKind[]): boolean {
  return (Object.keys(BAN_SCOPE_ROLES) as BanScope[]).some(s => hasRole(roles, BAN_SCOPE_ROLES[s]))
}

const FORUM_MOD_ROLES: RoleKind[] = ['forum_mod']
const BOARD_MOD_ROLES: RoleKind[] = ['forum_mod', 'board_mod']
const THREAD_ADMIN_MGMT_ROLES: RoleKind[] = ['forum_mod', 'board_mod', 'thread_admin']
const PIN_ROLES: RoleKind[] = ['forum_mod', 'board_mod']

export function canBoardSettings(roles: RoleKind[]): boolean {
  return hasRole(roles, BOARD_MOD_ROLES)
}

export function canBoardCore(roles: RoleKind[]): boolean {
  return hasRole(roles, FORUM_MOD_ROLES)
}

export function canThreadPin(roles: RoleKind[]): boolean {
  return hasRole(roles, PIN_ROLES)
}

function roleFor(options: RoleOption[], allowed: RoleKind[]): RoleOption | null {
  return options.find(o => allowed.includes(o.kind) && signable(o)) ?? null
}

export function roleForForumSettings(options: RoleOption[]): RoleOption | null {
  return roleFor(options, FORUM_MOD_ROLES)
}

export function roleForBoardCore(options: RoleOption[]): RoleOption | null {
  return roleFor(options, FORUM_MOD_ROLES)
}

export function roleForBoardSoft(options: RoleOption[]): RoleOption | null {
  return roleFor(options, BOARD_MOD_ROLES)
}

export function roleForThreadAdminMgmt(options: RoleOption[]): RoleOption | null {
  return roleFor(options, THREAD_ADMIN_MGMT_ROLES)
}

export function selfModerationDeadline(created: number, mine: boolean, now: number): number | null {
  const deadline = created + SELF_MOD_WINDOW_MS + 1
  return mine && now < deadline ? deadline : null
}

export const MOD_KINDS: RoleKind[] = ['forum_mod', 'board_mod', 'thread_admin', 'thread_mod']

const MOD_LEVELS: Partial<Record<RoleKind, number>> = { forum_mod: 4, board_mod: 3, thread_admin: 2, thread_mod: 1 }

export function hasModRole(kinds: RoleKind[]): boolean {
  return kinds.some((kind) => MOD_KINDS.includes(kind))
}

export function accessLevel(kinds: RoleKind[]): number {
  return kinds.reduce((max, kind) => Math.max(max, MOD_LEVELS[kind] ?? 0), 0)
}
