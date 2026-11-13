import { bcs } from '@mysten/bcs'

const GuestErrorSchema = bcs.enum('GuestError', {
  Bcs: bcs.string(),
  Unbound: null,
  InvalidKey: null,
  Limit: null,
  Batch: null,
})

const EntityErrorSchema = bcs.enum('EntityError', {
  Guest: GuestErrorSchema,
  UnsupportedVersion: bcs.struct('UnsupportedVersion', { stored: bcs.u32(), current: bcs.u32() }),
  Message: bcs.struct('Message', { namespace: bcs.string(), reason: bcs.string() }),
  UnknownFunction: bcs.struct('UnknownFunction', { namespace: bcs.string(), function: bcs.string() }),
  NotFound: null,
  InvalidArguments: null,
  MissingRoot: null,
  KeyChanged: null,
  Decode: bcs.string(),
  MissingWrite: null,
  Outdated: null,
  Encode: bcs.string(),
})

export const ForumErrorSchema = bcs.enum('ForumError', {
  Entity: EntityErrorSchema,
  Guest: GuestErrorSchema,
  RootOwnerRequired: null,
  NotAuthorized: null,
  InvalidBanExpiry: null,
  InvalidBoardSlug: null,
  InvalidBumpLimit: null,
  InvalidMaxMedia: null,
  DuplicateReaction: null,
  PinnedThreadLimit: null,
  BoardReadOnly: null,
  TooManyAttachments: null,
  Banned: null,
  ThreadClosed: null,
  MissingPostIndex: null,
  InvalidPostIndex: null,
  InvalidPollSize: null,
  DuplicatePollChoice: null,
  EmptyPost: null,
  PostRequiresMedia: null,
  PollUnavailable: null,
  InvalidVoteCount: null,
  AlreadyVoted: null,
  InvalidPollChoice: null,
  PostDeleted: null,
  ReactionNotAllowed: null,
  ReactionConflict: null,
  InvalidReactionCount: null,
  MediaNotFound: null,
  MediaAlreadyBanned: null,
  MediaNotBanned: null,
  CounterOverflow: null,
  NotFound: null,
  ForumExists: null,
  BoardExists: null,
  InvalidContentHash: null,
  InvalidBoardCursor: null,
})

export type ForumError = typeof ForumErrorSchema.$inferType

const ProtocolErrorSchema = bcs.enum('ProtocolError', {
  Bcs: bcs.string(),
  Hex: null,
  Root: null,
})

const SdkErrorSchema = bcs.enum('SdkError', {
  Protocol: ProtocolErrorSchema,
  Random: null,
  Root: null,
  Esid: null,
  Proof: null,
})

const RejectSchema = bcs.enum('Reject', {
  UnknownNative: bcs.struct('UnknownNative', { function: bcs.string() }),
  Application: bcs.struct('Application', { bytes: bcs.vector(bcs.u8()) }),
  BadRequest: null,
  BadSignature: null,
  Duplicate: null,
  NotFound: null,
  ProgramNotFound: null,
  NotAProgram: null,
  Abi: null,
  InvalidWasm: null,
  OutOfFuel: null,
  VmTrap: null,
  ResourceLimit: null,
  ReadOnly: null,
  Integrity: null,
  Unavailable: null,
})

const DbErrorSchema = bcs.enum('DbError', {
  Reject: RejectSchema,
  Status: bcs.u16(),
  Transport: bcs.string(),
  Codec: bcs.string(),
})

export const DomainErrorSchema = bcs.enum('DomainError', {
  Protocol: ProtocolErrorSchema,
  Sdk: SdkErrorSchema,
  Db: DbErrorSchema,
  Http: bcs.struct('Http', { status: bcs.u16(), message: bcs.string() }),
  NotFound: null,
  BadRequest: bcs.string(),
  Program: bcs.string(),
  Internal: bcs.string(),
  Codec: bcs.string(),
  Store: bcs.string(),
})

export type DomainError = typeof DomainErrorSchema.$inferType
export type ProtocolError = typeof ProtocolErrorSchema.$inferType
export type SdkError = typeof SdkErrorSchema.$inferType
export type DbError = typeof DbErrorSchema.$inferType
