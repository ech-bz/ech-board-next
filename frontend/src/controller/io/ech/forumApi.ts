import { bcs } from '@mysten/bcs'

import type { SessionState } from '../../../model/state/session'
import { Identity, randomTweak } from '../crypto/identity'
import type { BoardPageEntity, PostPageEntity, ThreadPageEntity, UserRequests } from './protocol/entities'
import type { BoardCursor } from '../../../model/entities/board'
import { EntityId } from './protocol/entityId'
import { EsidSchema, type Esid, type Media, type Resources } from './protocol/transactions'
import * as relay from './relay'

const Hash = bcs.bytes(32)
const hashList = bcs.vector(Hash)
const EsidField = EsidSchema

export type Call = {
  function: string
  args: Uint8Array
  decryptions: Esid[]
}

const clean = (value: string) => value.replace(/^0x/, '')
const optionalHash = (value: string | null): Uint8Array | null =>
  value === null ? null : relay.unhex(clean(value))
const hashBytes = (value: string): Uint8Array => relay.unhex(clean(value))
const esidBytes = (value: string): Esid => EsidField.parse(relay.unhex(clean(value)))

const call = (
  functionName: string,
  args: Uint8Array,
  decryptions: Esid[] = [],
): Call => ({ function: functionName, args, decryptions })

const tuple = (...fields: Parameters<typeof bcs.tuple>[0]) =>
  bcs.tuple(fields)

const withId = (id: string, args: Uint8Array): Uint8Array => {
  const bytes = relay.unhex(clean(id))
  const out = new Uint8Array(32 + args.length)
  out.set(bytes)
  out.set(args, 32)
  return out
}

export const Calls = {
  forum: {
    create: () => call('forum.create', new Uint8Array()),
    create_board: (slug: string, description: string | null) =>
      call(
        'forum.create_board',
        withId(
          EntityId.forum(),
          tuple(bcs.string(), bcs.option(Hash))
            .serialize([slug, optionalHash(description)])
            .toBytes(),
        ),
      ),
    set_title: (title: string) =>
      call(
        'forum.set_title',
        withId(EntityId.forum(), tuple(Hash).serialize([hashBytes(title)]).toBytes()),
      ),
    add_moderator: (member: string) =>
      call(
        'forum.add_moderator',
        withId(EntityId.forum(), tuple(EsidField).serialize([esidBytes(member)]).toBytes()),
      ),
    remove_moderator: (member: string) =>
      call(
        'forum.remove_moderator',
        withId(EntityId.forum(), tuple(EsidField).serialize([esidBytes(member)]).toBytes()),
      ),
    ban: (target: string, reason: string | null, expires: bigint) =>
      call(
        'forum.ban',
        withId(
          EntityId.forum(),
          tuple(EsidField, bcs.option(Hash), bcs.u64())
            .serialize([esidBytes(target), optionalHash(reason), expires])
            .toBytes(),
        ),
        [esidBytes(target)],
      ),
    unban: (target: string) =>
      call(
        'forum.unban',
        withId(EntityId.forum(), tuple(EsidField).serialize([esidBytes(target)]).toBytes()),
        [esidBytes(target)],
      ),
    ban_list: (after: string | null, limit: number) =>
      call(
        'forum.ban_list',
        withId(
          EntityId.forum(),
          tuple(bcs.option(EsidField), bcs.u32())
            .serialize([after === null ? null : esidBytes(after), limit])
            .toBytes(),
        ),
      ),
  },
  board: {
    create_thread: (
      id: string,
      topic: string | null,
      textHash: string | null,
      media: string[],
      name: string | null,
      votes: string[],
      multi: boolean,
      selfAdmin: boolean,
    ) =>
      call(
        'board.create_thread',
        withId(
          id,
          tuple(
            bcs.option(Hash),
            bcs.option(Hash),
            hashList,
            bcs.option(Hash),
            hashList,
            bcs.bool(),
            bcs.bool(),
          )
            .serialize([
              optionalHash(topic),
              optionalHash(textHash),
              media.map(hashBytes),
              optionalHash(name),
              votes.map(hashBytes),
              multi,
              selfAdmin,
            ])
            .toBytes(),
        ),
      ),
    set_readonly: (id: string, value: boolean) =>
      call('board.set_readonly', withId(id, tuple(bcs.bool()).serialize([value]).toBytes())),
    set_bump_limit: (id: string, value: number) =>
      call('board.set_bump_limit', withId(id, tuple(bcs.u32()).serialize([value]).toBytes())),
    set_max_media: (id: string, value: number) =>
      call('board.set_max_media', withId(id, tuple(bcs.u8()).serialize([value]).toBytes())),
    set_description: (id: string, value: string | null) =>
      call(
        'board.set_description',
        withId(id, tuple(bcs.option(Hash)).serialize([optionalHash(value)]).toBytes()),
      ),
    set_ignore_forum_bans: (id: string, value: boolean) =>
      call(
        'board.set_ignore_forum_bans',
        withId(id, tuple(bcs.bool()).serialize([value]).toBytes()),
      ),
    set_reactions: (id: string, values: string[]) =>
      call(
        'board.set_reactions',
        withId(id, tuple(hashList).serialize([values.map(hashBytes)]).toBytes()),
      ),
    set_pinned: (id: string, values: number[]) =>
      call(
        'board.set_pinned',
        withId(id, tuple(bcs.vector(bcs.u64())).serialize([values]).toBytes()),
      ),
    add_moderator: (id: string, member: string) =>
      call(
        'board.add_moderator',
        withId(id, tuple(EsidField).serialize([esidBytes(member)]).toBytes()),
      ),
    remove_moderator: (id: string, member: string) =>
      call(
        'board.remove_moderator',
        withId(id, tuple(EsidField).serialize([esidBytes(member)]).toBytes()),
      ),
    ban: (id: string, target: string, reason: string | null, expires: bigint) =>
      call(
        'board.ban',
        withId(
          id,
          tuple(EsidField, bcs.option(Hash), bcs.u64())
            .serialize([esidBytes(target), optionalHash(reason), expires])
            .toBytes(),
        ),
        [esidBytes(target)],
      ),
    unban: (id: string, target: string) =>
      call(
        'board.unban',
        withId(id, tuple(EsidField).serialize([esidBytes(target)]).toBytes()),
        [esidBytes(target)],
      ),
    ban_list: (id: string, after: string | null, limit: number) =>
      call(
        'board.ban_list',
        withId(
          id,
          tuple(bcs.option(EsidField), bcs.u32())
            .serialize([after === null ? null : esidBytes(after), limit])
            .toBytes(),
        ),
      ),
    create_post: (
      id: string,
      thread: number,
      textHash: string | null,
      media: string[],
      name: string | null,
      votes: string[],
      multi: boolean,
    ) =>
      call(
        'board.create_post',
        withId(
          id,
          tuple(
            bcs.u64(),
            bcs.option(Hash),
            hashList,
            bcs.option(Hash),
            hashList,
            bcs.bool(),
          )
            .serialize([
              thread,
              optionalHash(textHash),
              media.map(hashBytes),
              optionalHash(name),
              votes.map(hashBytes),
              multi,
            ])
            .toBytes(),
        ),
      ),
  },
  thread: {
    set_closed: (id: string, value: boolean) =>
      call('thread.set_closed', withId(id, tuple(bcs.bool()).serialize([value]).toBytes())),
    set_pinned: (id: string, value: boolean) =>
      call('thread.set_pinned', withId(id, tuple(bcs.bool()).serialize([value]).toBytes())),
    set_deleted: (id: string, value: boolean) =>
      call('thread.set_deleted', withId(id, tuple(bcs.bool()).serialize([value]).toBytes())),
    set_topic: (id: string, value: string | null) =>
      call(
        'thread.set_topic',
        withId(id, tuple(bcs.option(Hash)).serialize([optionalHash(value)]).toBytes()),
      ),
    set_admin: (id: string, admin: string | null) =>
      call(
        'thread.set_admin',
        withId(
          id,
          tuple(bcs.option(EsidField))
            .serialize([admin === null ? null : esidBytes(admin)])
            .toBytes(),
        ),
      ),
    add_moderator: (id: string, member: string) =>
      call(
        'thread.add_moderator',
        withId(id, tuple(EsidField).serialize([esidBytes(member)]).toBytes()),
      ),
    remove_moderator: (id: string, member: string) =>
      call(
        'thread.remove_moderator',
        withId(id, tuple(EsidField).serialize([esidBytes(member)]).toBytes()),
      ),
    ban: (id: string, target: string, reason: string | null, expires: bigint) =>
      call(
        'thread.ban',
        withId(
          id,
          tuple(EsidField, bcs.option(Hash), bcs.u64())
            .serialize([esidBytes(target), optionalHash(reason), expires])
            .toBytes(),
        ),
        [esidBytes(target)],
      ),
    unban: (id: string, target: string) =>
      call(
        'thread.unban',
        withId(id, tuple(EsidField).serialize([esidBytes(target)]).toBytes()),
        [esidBytes(target)],
      ),
    ban_list: (id: string, after: string | null, limit: number) =>
      call(
        'thread.ban_list',
        withId(
          id,
          tuple(bcs.option(EsidField), bcs.u32())
            .serialize([after === null ? null : esidBytes(after), limit])
            .toBytes(),
        ),
      ),
  },
  post: {
    get: (id: string) => call('post.get', withId(id, new Uint8Array())),
    set_text: (id: string, value: string | null) =>
      call(
        'post.set_text',
        withId(id, tuple(bcs.option(Hash)).serialize([optionalHash(value)]).toBytes()),
      ),
    set_deleted: (id: string, value: boolean) =>
      call(
        'post.set_deleted',
        withId(id, tuple(bcs.bool()).serialize([value]).toBytes()),
      ),
    ban_media: (id: string, hashes: string[]) =>
      call(
        'post.ban_media',
        withId(id, tuple(hashList).serialize([hashes.map(hashBytes)]).toBytes()),
      ),
    unban_media: (id: string, hashes: string[]) =>
      call(
        'post.unban_media',
        withId(id, tuple(hashList).serialize([hashes.map(hashBytes)]).toBytes()),
      ),
    set_banned: (id: string, banned: string | null) =>
      call(
        'post.set_banned',
        withId(
          id,
          tuple(bcs.option(EsidField))
            .serialize([banned === null ? null : esidBytes(banned)])
            .toBytes(),
        ),
      ),
    set_mod_note: (id: string, value: string | null) =>
      call(
        'post.set_mod_note',
        withId(id, tuple(bcs.option(Hash)).serialize([optionalHash(value)]).toBytes()),
      ),
    vote: (id: string, choices: string[]) =>
      call(
        'post.vote',
        withId(id, tuple(hashList).serialize([choices.map(hashBytes)]).toBytes()),
      ),
    react: (id: string, old: string | null, reaction: string) =>
      call(
        'post.react',
        withId(
          id,
          tuple(bcs.option(Hash), Hash)
            .serialize([optionalHash(old), hashBytes(reaction)])
            .toBytes(),
        ),
      ),
  },
}

export class ForumApi {
  constructor(readonly relay: relay.Relay, private readonly state: SessionState) { }

  get root(): Uint8Array {
    return this.relay.root
  }

  get identity(): Identity {
    return Identity.fromHex(this.state.master)
  }

  async append(
    operation: Call,
    blobs: { hash: string; bytes: Uint8Array }[] = [],
    tweak: Uint8Array = randomTweak(),
    onPrepared?: (txid: string) => void,
    requests: UserRequests = relay.NO_REQUESTS,
    trip: string | null = null,
  ): Promise<{ txid: string; result: Uint8Array }> {
    const identity = this.identity
    return relay.submit(
      this.relay,
      identity,
      relay.call(this.relay, operation.function, operation.args),
      {
        tweak,
        decrypt: [identity.esid(this.relay.root, tweak), ...operation.decryptions],
      },
      requests,
      trip,
      blobs.map((blob) => blob.bytes),
      onPrepared,
    )
  }

  private access(): relay.Access {
    const tweak = randomTweak()
    return { tweak, decrypt: [this.identity.esid(this.root, tweak)] }
  }

  async query(operation: Call): Promise<Uint8Array> {
    return relay.query(
      this.relay,
      this.identity,
      relay.call(this.relay, operation.function, operation.args),
      { decrypt: operation.decryptions },
    )
  }

  async loadContent(hash: string | Uint8Array): Promise<Uint8Array | null> {
    const key = typeof hash === 'string' ? clean(hash) : relay.hex(hash)
    return relay.getContent(this.relay, key)
  }

  async loadAttachment(hash: string | Uint8Array): Promise<Media | null> {
    const key = typeof hash === 'string' ? clean(hash) : relay.hex(hash)
    return relay.getMediaMeta(this.relay, key)
  }

  metadata(board?: string, thread?: number) {
    return relay.readMetadata(this.relay, this.identity, {}, board, thread)
  }

  async board(slug: string, before: BoardCursor | null = null): Promise<Resources<BoardPageEntity>> {
    const page = await relay.readBoard(
      this.relay,
      this.identity,
      EntityId.board(slug),
      before,
      this.access(),
    )
    return page
  }

  async threadPages(slug: string, number: number, cursors: number[]): Promise<Resources<ThreadPageEntity>[]> {
    const pages = await relay.readThreadPages(
      this.relay,
      this.identity,
      EntityId.thread(slug, number),
      cursors,
      this.access(),
    )
    return pages
  }

  async post(id: string): Promise<Resources<PostPageEntity>> {
    const page = await relay.readPost(
      this.relay,
      this.identity,
      relay.unhex(clean(id)),
      this.access(),
    )
    return page
  }

}
