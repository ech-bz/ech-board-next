import { bcs, type BcsType } from '@mysten/bcs'

export const Hash = bcs.bytes(32)
const hashList = bcs.vector(Hash)
const text = new TextEncoder()

export const EsidSchema = bcs.struct('Esid', {
  tweak: Hash,
  c1: Hash,
  c2: Hash,
})

export const ProofSchema = bcs.struct('Proof', {
  commitment: hashList,
  response: hashList,
})

export const TermSchema = bcs.struct('Term', {
  base: Hash,
  response: bcs.u16(),
})

export const EquationSchema = bcs.struct('Equation', {
  terms: bcs.vector(TermSchema),
  target: Hash,
})

export const StatementSchema = bcs.struct('Statement', {
  equations: bcs.vector(EquationSchema),
})

export const ProgramSchema = bcs.enum('Program', {
  Txid: Hash,
  Native: null,
})

export const CallSchema = bcs.struct('Call', {
  program: ProgramSchema,
  function: bcs.string(),
  args: bcs.byteVector(),
})

export const AuthorSchema = bcs.enum('Author', {
  User: bcs.struct('UserAuthor', { esid: EsidSchema, proof: ProofSchema }),
  Server: null,
})

export const UserPartSchema = bcs.struct('UserPart', {
  ctx: bcs.byteVector(),
  call: CallSchema,
  author: AuthorSchema,
})

export const SignedSchema = bcs.struct('Signed', {
  user: UserPartSchema,
  decryptions: bcs.vector(EsidSchema),
})

export const MediaMetaSchema = bcs.struct('MediaMeta', {
  mime: bcs.string(),
  width: bcs.u32(),
  height: bcs.u32(),
  duration_ms: bcs.option(bcs.u64()),
  size: bcs.u64(),
  thumbnail: bcs.bool(),
})

export const ResourcesSchema = <T extends BcsType<any, any, any>>(view: T) =>
  bcs.struct('WithResources', {
    view,
    contents: bcs.map(Hash, bcs.option(bcs.byteVector())),
    attachments: bcs.map(Hash, bcs.option(MediaMetaSchema)),
  })

export const HistoryEntrySchema = bcs.struct('HistoryEntry', {
  sequence: bcs.u64(),
  txid: Hash,
})

export const UserContext = bcs.tuple([Hash, bcs.byteVector(), CallSchema])

export const ChallengePayload = bcs.tuple([StatementSchema, bcs.byteVector(), hashList])

export type Call = typeof CallSchema.$inferType
export type Esid = typeof EsidSchema.$inferType
export type Proof = typeof ProofSchema.$inferType
export type Statement = typeof StatementSchema.$inferType
export type UserPart = typeof UserPartSchema.$inferType
export type Signed = typeof SignedSchema.$inferType
export type Media = typeof MediaMetaSchema.$inferType
export type HistoryEntry = typeof HistoryEntrySchema.$inferType
export type Resources<T> = {
  view: T
  contents: Map<string, Uint8Array | null>
  attachments: Map<string, Media | null>
}

export function encodeText(value: string): Uint8Array {
  return text.encode(value)
}

export function emptyTable(): number[] {
  return []
}

export function uleb(value: number): number[] {
  const out: number[] = []
  let rest = value
  do {
    out.push((rest & 0x7f) | (rest > 0x7f ? 0x80 : 0))
    rest >>>= 7
  } while (rest)
  return out
}

export function utf8(value: string): number[] {
  const bytes = Array.from(text.encode(value))
  return [...uleb(bytes.length), ...bytes]
}

export function u64(value: number): number[] {
  const out: number[] = []
  let rest = BigInt(value)
  for (let index = 0; index < 8; index += 1) {
    out.push(Number(rest & 0xffn))
    rest >>= 8n
  }
  return out
}
