import type { Entity } from './entity'
import type { Identity } from './identity'
import type { RoleOption } from '../rules/roles'

export interface Forum extends Entity {
  readonly title: string
  readonly titleHash: Uint8Array | null
  readonly moderators: Identity[]
  readonly roles: RoleOption[]
}
