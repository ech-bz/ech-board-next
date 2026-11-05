use serde::{Deserialize, Serialize};

use ech_board_entity::{entity, Bind, Dispatch, Entity, Record, TableVec};

use crate::context::{decode_arguments, encode, fail, Context};
use crate::error::ForumError;
use crate::model::{
    unique, BanValue, Bans, Esid, Forum, ForumKey, ForumV1, Hash, Post, PostKey, PostV1, Thread,
    ThreadKey, ThreadPreview, ThreadV1,
};

static PAGE_THREADS: usize = 10;
static PAGE_BUMP: usize = 32;

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct BoardKey {
    pub slug: String,
}

#[entity(BoardKey)]
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub enum Board {
    V1(BoardV1),
}

#[derive(Bind, Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct BoardV1 {
    pub description_hash: Option<Hash>,
    pub readonly: bool,
    pub bump_limit: u32,
    pub max_media: u8,
    pub thread_count: u64,
    pub post_count: u64,
    pub pinned: Vec<u64>,
    pub reactions: Vec<Hash>,
    pub moderators: Vec<Esid>,
    pub ignore_forum_bans: bool,
    pub bumps: TableVec<u64>,
    pub bans: Bans,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct BoardPage {
    pub threads: Vec<ThreadPreview>,
    pub next: Option<u64>,
}

impl BoardV1 {
    fn check_bans(&self, context: &Context, forum: &ForumV1) -> Result<(), Vec<u8>> {
        if crate::context::read_only() || context.is_server() {
            return Ok(());
        }
        let sid = context.author_sid()?;
        let mut bans = vec![&self.bans];
        if !self.ignore_forum_bans {
            bans.push(&forum.bans);
        }
        if Bans::any_banned(&bans, &sid, context.time)? {
            return Err(fail(ForumError::Banned));
        }
        Ok(())
    }

    pub(crate) fn is_moderator(&self, context: &Context, forum: &ForumV1) -> bool {
        forum.is_moderator(context) || self.moderators.iter().any(|esid| context.is_author(esid))
    }

    pub(crate) fn allocate_post(&mut self, thread: u64, bump: bool) -> Result<u64, Vec<u8>> {
        self.post_count = self
            .post_count
            .checked_add(1)
            .ok_or_else(|| fail(ForumError::CounterOverflow))?;
        if bump {
            self.bumps.push(&thread)?;
        }
        Ok(self.post_count)
    }

    pub(crate) fn pin(&mut self, number: u64) -> Result<(), Vec<u8>> {
        if self.pinned.len() >= 8 && !self.pinned.contains(&number) {
            return Err(fail(ForumError::PinnedThreadLimit));
        }
        if !self.pinned.contains(&number) {
            self.pinned.push(number);
            self.pinned.sort_unstable_by(|a, b| b.cmp(a));
        }
        Ok(())
    }

    pub(crate) fn unpin(&mut self, number: u64) {
        self.pinned.retain(|entry| *entry != number);
    }

    pub(crate) fn listing() -> Result<Vec<Entity<Board>>, Vec<u8>> {
        ech_board_entity::scan::<Board>()
    }
}

impl Dispatch<Context> for Board {
    #[allow(clippy::type_complexity)]
    fn dispatch(
        id: &[u8; 32],
        context: &Context,
        method: &str,
        args: &[u8],
    ) -> Result<Vec<u8>, Vec<u8>> {
        if method == "create_post" {
            let (board, forum) =
                ech_board_entity::load_pair::<Board, Forum>(id, &Forum::id(&ForumKey {}))?;
            return create_post(board, forum, context, args);
        }
        let mut board = Self::load_by_id(id)?;
        if !crate::context::read_only() && !context.is_server() {
            let forum = Forum::load(&ForumKey {})?;
            board.check_bans(context, forum.inner())?;
        }
        match method {
            "meta" => encode(&board),
            "page" => {
                let (before,): (u64,) = decode_arguments(args)?;
                let pinned = board.pinned.clone();
                let mut numbers: Vec<u64> = if before == 0 {
                    pinned.clone()
                } else {
                    Vec::new()
                };
                let mut cursor = if before == 0 {
                    board.bumps.len()
                } else {
                    before
                };
                loop {
                    let rows = board.bumps.tail(Some(cursor), PAGE_BUMP)?;
                    if rows.is_empty() {
                        break;
                    }
                    for (sequence, number) in rows {
                        cursor = sequence;
                        if numbers.contains(&number) {
                            continue;
                        }
                        numbers.push(number);
                        if numbers.len() == pinned.len() + PAGE_THREADS {
                            let threads = previews(&board, &numbers, pinned.len())?;
                            return encode(&BoardPage {
                                threads,
                                next: (cursor > 0).then_some(cursor),
                            });
                        }
                    }
                }
                let threads = previews(&board, &numbers, pinned.len())?;
                encode(&BoardPage {
                    threads,
                    next: (cursor > 0).then_some(cursor),
                })
            }
            "add_moderator" => {
                let (member,): (Esid,) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                if !forum.is_moderator(context) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                if !board.moderators.contains(&member) {
                    board.moderators.push(member);
                }
                board.save()?;
                encode(&(board.key.clone(), board.inner().clone()))
            }
            "remove_moderator" => {
                let (member,): (Esid,) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                if !forum.is_moderator(context) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                board.moderators.retain(|entry| *entry != member);
                board.save()?;
                encode(&(board.key.clone(), board.inner().clone()))
            }
            "ban" => {
                let (target, reason_hash, expires): (Esid, Option<Hash>, u64) =
                    decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                if !board.is_moderator(context, forum.inner()) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                if expires != 0 && expires <= context.time {
                    return Err(fail(ForumError::InvalidBanExpiry));
                }
                let sid = context.sid(&target)?;
                board.bans.ban(
                    target,
                    sid,
                    BanValue {
                        reason_hash,
                        expires,
                    },
                )?;
                encode(&board.bans.entries(None, 32)?)
            }
            "unban" => {
                let (target,): (Esid,) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                if !board.is_moderator(context, forum.inner()) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                let sid = context.sid(&target)?;
                board.bans.unban(&target, &sid)?;
                encode(&board.bans.entries(None, 32)?)
            }
            "ban_list" => {
                let (after, limit): (Option<Esid>, u32) = decode_arguments(args)?;
                encode(&board.bans.entries(after.as_ref(), limit as usize)?)
            }
            "set_readonly" => {
                let (value,): (bool,) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                if !forum.is_moderator(context) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                board.readonly = value;
                board.save()?;
                encode(&(board.key.clone(), board.inner().clone()))
            }
            "set_bump_limit" => {
                let (value,): (u32,) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                if !forum.is_moderator(context) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                if value == 0 {
                    return Err(fail(ForumError::InvalidBumpLimit));
                }
                board.bump_limit = value;
                board.save()?;
                encode(&(board.key.clone(), board.inner().clone()))
            }
            "set_max_media" => {
                let (value,): (u8,) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                if !forum.is_moderator(context) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                if value > 16 {
                    return Err(fail(ForumError::InvalidMaxMedia));
                }
                board.max_media = value;
                board.save()?;
                encode(&(board.key.clone(), board.inner().clone()))
            }
            "set_description" => {
                let (value,): (Option<Hash>,) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                if !board.is_moderator(context, forum.inner()) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                board.description_hash = value;
                board.save()?;
                encode(&(board.key.clone(), board.inner().clone()))
            }
            "set_ignore_forum_bans" => {
                let (value,): (bool,) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                if !board.is_moderator(context, forum.inner()) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                board.ignore_forum_bans = value;
                board.save()?;
                encode(&(board.key.clone(), board.inner().clone()))
            }
            "set_reactions" => {
                let (values,): (Vec<Hash>,) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                if !board.is_moderator(context, forum.inner()) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                if unique(&values).is_none() {
                    return Err(fail(ForumError::DuplicateReaction));
                }
                board.reactions = values;
                board.save()?;
                encode(&(board.key.clone(), board.inner().clone()))
            }
            "set_pinned" => {
                let (values,): (Vec<u64>,) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                if !board.is_moderator(context, forum.inner()) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                board.pinned = values;
                board.pinned.sort_unstable_by(|a, b| b.cmp(a));
                board.save()?;
                encode(&(board.key.clone(), board.inner().clone()))
            }
            "create_thread" => {
                let (
                    topic_hash,
                    text_hash,
                    media_hashes,
                    name_hash,
                    vote_keys,
                    multi_vote,
                    self_admin,
                ): (
                    Option<Hash>,
                    Option<Hash>,
                    Vec<Hash>,
                    Option<Hash>,
                    Vec<Hash>,
                    bool,
                    bool,
                ) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                if board.readonly && !board.is_moderator(context, forum.inner()) {
                    return Err(fail(ForumError::BoardReadOnly));
                }
                if media_hashes.len() > board.max_media as usize {
                    return Err(fail(ForumError::TooManyAttachments));
                }
                if !vote_keys.is_empty() && !(2..=16).contains(&vote_keys.len()) {
                    return Err(fail(ForumError::InvalidPollSize));
                }
                if unique(&vote_keys).is_none() {
                    return Err(fail(ForumError::DuplicatePollChoice));
                }
                if text_hash.is_none() && media_hashes.is_empty() {
                    return Err(fail(ForumError::EmptyPost));
                }
                let esid = context.esid()?;
                board.post_count = board
                    .post_count
                    .checked_add(1)
                    .ok_or_else(|| fail(ForumError::CounterOverflow))?;
                let number = board.post_count;
                let thread = Thread::insert(
                    ThreadKey {
                        board: board.key.slug.clone(),
                        number,
                    },
                    Thread::V1(ThreadV1::new(
                        number,
                        topic_hash,
                        if self_admin { Some(esid) } else { None },
                    )),
                )?;
                thread.posts.insert(&1, &number)?;
                Post::insert(
                    PostKey {
                        board: board.key.slug.clone(),
                        number,
                    },
                    Post::V1(PostV1::new(
                        number,
                        text_hash,
                        media_hashes,
                        name_hash,
                        multi_vote,
                        vote_keys,
                    )),
                )?;
                board.thread_count = board
                    .thread_count
                    .checked_add(1)
                    .ok_or_else(|| fail(ForumError::CounterOverflow))?;
                board.bumps.push(&number)?;
                board.save()?;
                encode(&number)
            }
            _ => Err(ech_board_entity::unknown_function("board", method)),
        }
    }
}

fn previews(
    board: &Entity<Board>,
    numbers: &[u64],
    pinned: usize,
) -> Result<Vec<ThreadPreview>, Vec<u8>> {
    let keys: Vec<ThreadKey> = numbers
        .iter()
        .map(|number| ThreadKey {
            board: board.key.slug.clone(),
            number: *number,
        })
        .collect();
    let mut threads = Vec::new();
    for (index, thread) in Thread::load_many(&keys)?.into_iter().enumerate() {
        let Some(thread) = thread else {
            continue;
        };
        if index < pinned || !thread.pinned {
            threads.push(ThreadV1::preview_of(thread)?);
        }
    }
    Ok(threads)
}

fn create_post(
    mut board: Entity<Board>,
    forum: Entity<Forum>,
    context: &Context,
    args: &[u8],
) -> Result<Vec<u8>, Vec<u8>> {
    let (number, text_hash, media_hashes, name_hash, vote_keys, multi_vote): (
        u64,
        Option<Hash>,
        Vec<Hash>,
        Option<Hash>,
        Vec<Hash>,
        bool,
    ) = decode_arguments(args)?;
    let sid = if crate::context::read_only() || context.is_server() {
        None
    } else {
        Some(context.author_sid()?)
    };
    let mut bans = Vec::new();
    if sid.is_some() {
        bans.push(&board.bans);
        if !board.ignore_forum_bans {
            bans.push(&forum.bans);
        }
    }
    let entries: Vec<_> = bans
        .iter()
        .filter_map(|bans| sid.as_ref().map(|sid| (&bans.private, sid)))
        .collect();
    let (mut thread, authors) = ech_board_entity::load_with_entries::<Thread, _, _>(
        &Thread::id(&ThreadKey {
            board: board.key.slug.clone(),
            number,
        }),
        &entries,
    )?;
    if Bans::any_active(&bans, &authors, context.time)? {
        return Err(fail(ForumError::Banned));
    }
    if board.readonly && !board.is_moderator(context, forum.inner()) {
        return Err(fail(ForumError::BoardReadOnly));
    }
    if thread.closed && !thread.is_moderator(context, forum.inner(), board.inner()) {
        return Err(fail(ForumError::ThreadClosed));
    }
    if media_hashes.len() > board.max_media as usize {
        return Err(fail(ForumError::TooManyAttachments));
    }
    if !vote_keys.is_empty() && !(2..=16).contains(&vote_keys.len()) {
        return Err(fail(ForumError::InvalidPollSize));
    }
    if unique(&vote_keys).is_none() {
        return Err(fail(ForumError::DuplicatePollChoice));
    }
    if text_hash.is_none() && media_hashes.is_empty() {
        return Err(fail(ForumError::EmptyPost));
    }
    let bump = thread.post_count < board.bump_limit as u64;
    let post_number = board.allocate_post(number, bump)?;
    if bump {
        thread.bump = post_number;
    }
    let post_key = PostKey {
        board: board.key.slug.clone(),
        number: post_number,
    };
    let mut writes =
        ech_board_entity::WriteBatch::new(&[Post::id(&post_key), thread.id(), board.id()])?;
    let post = writes.insert(
        post_key,
        Post::V1(PostV1::new(
            number,
            text_hash,
            media_hashes,
            name_hash,
            multi_vote,
            vote_keys,
        )),
    )?;
    thread.post_count = thread
        .post_count
        .checked_add(1)
        .ok_or_else(|| fail(ForumError::CounterOverflow))?;
    thread.posts.insert(&thread.post_count, &post_number)?;
    thread.last_posts.push(post_number);
    if thread.last_posts.len() > 3 {
        thread.last_posts.remove(0);
    }
    writes.save(&mut thread)?;
    writes.save(&mut board)?;
    encode(post.inner())
}
