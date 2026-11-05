import { resourceKey } from '../state/resources'
import { toHex } from './hex'
import type { PostPart } from './postPart'

export type SecretContent = Extract<PostPart, { Secret: unknown }>['Secret']

export const secretKey = (forumId: string, author: string, secret: SecretContent): string => resourceKey(forumId.replace(/^0x/, ''), author, toHex(secret.data_nonce), toHex(secret.data_ct))
