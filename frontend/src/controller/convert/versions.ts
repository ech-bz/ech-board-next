import type { BoardEntity, ForumEntity, PostEntity, ThreadEntity } from '../io/ech/protocol/entities'

export function postValue(entity: PostEntity) {
  switch (entity.value.$kind) {
    case 'V1': return entity.value.V1
    default: throw new Error(`Unsupported post version: ${entity.value.$kind}`)
  }
}

export function threadValue(entity: ThreadEntity) {
  switch (entity.value.$kind) {
    case 'V1': return entity.value.V1
    default: throw new Error(`Unsupported thread version: ${entity.value.$kind}`)
  }
}

export function boardValue(entity: BoardEntity) {
  switch (entity.value.$kind) {
    case 'V1': return entity.value.V1
    default: throw new Error(`Unsupported board version: ${entity.value.$kind}`)
  }
}

export function forumValue(entity: ForumEntity) {
  switch (entity.value.$kind) {
    case 'V1': return entity.value.V1
    default: throw new Error(`Unsupported forum version: ${entity.value.$kind}`)
  }
}

