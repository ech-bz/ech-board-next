use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use ech_board_entity::Table;
use ech_board_entity::{entity, Bind, Dispatch, Entity, Record};

use crate::context::{decode_arguments, encode, fail, Context};
use crate::error::ForumError;
use crate::model::{
    BanValue, Bans, Board, BoardKey, BoardV1, Esid, Forum, ForumKey, ForumV1, Hash, Post, PostKey,
    PostV1, EDIT_WINDOW_MS,
};

pub const PAGE_POSTS: u64 = 1024;

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct ThreadKey {
    pub number: u64,
    pub board: String,
}

#[entity(ThreadKey)]
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub enum Thread {
    V1(ThreadV1),
}

#[derive(Bind, Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct ThreadV1 {
    pub topic_hash: Option<Hash>,
    pub closed: bool,
    pub pinned: bool,
    pub deleted: bool,
    pub post_count: u64,
    pub bump: u64,
    pub last_posts: Vec<u64>,
    pub admin: Option<Esid>,
    pub moderators: Vec<Esid>,
    pub posts: Table<u64, u64>,
    pub bans: Bans,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ThreadPage {
    pub my_reactions: BTreeMap<Hash, Hash>,
    pub posts: BTreeMap<u64, Entity<Post>>,
    pub next: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ThreadMeta {
    pub thread: Entity<Thread>,
    pub page_size: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ThreadPreview {
    pub thread: Entity<Thread>,
    pub posts: BTreeMap<u64, Entity<Post>>,
}

impl ThreadV1 {
    pub(crate) fn new(bump: u64, topic_hash: Option<Hash>, admin: Option<Esid>) -> ThreadV1 {
        ThreadV1 {
            topic_hash,
            closed: false,
            pinned: false,
            deleted: false,
            post_count: 1,
            bump,
            last_posts: Vec::new(),
            admin,
            moderators: Vec::new(),
            posts: Table::new(),
            bans: Bans::new(),
        }
    }

    pub(crate) fn is_moderator(&self, context: &Context, forum: &ForumV1, board: &BoardV1) -> bool {
        board.is_moderator(context, forum)
            || self.moderators.iter().any(|esid| context.is_author(esid))
            || self
                .admin
                .as_ref()
                .is_some_and(|admin| context.is_author(admin))
    }

    pub(crate) fn is_admin(&self, context: &Context, forum: &ForumV1, board: &BoardV1) -> bool {
        forum.is_moderator(context)
            || board.moderators.iter().any(|esid| context.is_author(esid))
            || self
                .admin
                .as_ref()
                .is_some_and(|admin| context.is_author(admin))
    }

    pub(crate) fn is_author(
        &self,
        context: &Context,
        post: &Entity<Post>,
    ) -> Result<bool, Vec<u8>> {
        let (author, created) = PostV1::genesis(&post.genesis)?;
        Ok(context.is_author(&author)
            && context.time >= created
            && context.time - created <= EDIT_WINDOW_MS)
    }

    pub(crate) fn previews(threads: Vec<Entity<Thread>>) -> Result<Vec<ThreadPreview>, Vec<u8>> {
        let keys: Vec<PostKey> = threads
            .iter()
            .flat_map(|thread| {
                std::iter::once(thread.key.number)
                    .chain(thread.last_posts.iter().copied())
                    .map(|number| PostKey {
                        board: thread.key.board.clone(),
                        number,
                    })
            })
            .collect();
        let mut loaded = Post::load_many(&keys)?.into_iter();
        threads
            .into_iter()
            .map(|thread| {
                let mut posts = BTreeMap::new();
                for _ in 0..=thread.last_posts.len() {
                    let post = loaded
                        .next()
                        .flatten()
                        .ok_or_else(|| fail(ForumError::NotFound))?;
                    posts.insert(post.key.number, post);
                }
                Ok(ThreadPreview { thread, posts })
            })
            .collect()
    }
}

impl Dispatch<Context> for Thread {
    #[allow(clippy::type_complexity)]
    fn dispatch(
        id: &[u8; 32],
        context: &Context,
        method: &str,
        args: &[u8],
    ) -> Result<Vec<u8>, Vec<u8>> {
        let mut thread = Self::load_by_id(id)?;
        if !crate::context::read_only() && !context.is_server() {
            let sid = context.author_sid()?;
            let board = Board::load(&BoardKey {
                slug: thread.key.board.clone(),
            })?;
            let forum = Forum::load(&ForumKey {})?;
            if thread.bans.banned(&sid, context.time)?
                || board.bans.banned(&sid, context.time)?
                || (!board.ignore_forum_bans && forum.bans.banned(&sid, context.time)?)
            {
                return Err(fail(ForumError::Banned));
            }
        }
        match method {
            "meta" => encode(&ThreadMeta {
                thread,
                page_size: PAGE_POSTS,
            }),
            "page" => {
                let (after,): (u64,) = decode_arguments(args)?;
                let end = thread.post_count.min(after.saturating_add(PAGE_POSTS));
                let sequences: Vec<u64> = (after.saturating_add(1)..=end).collect();
                let mut keys = Vec::with_capacity(sequences.len());
                for number in thread.posts.get_many(&sequences)? {
                    let number = number.ok_or_else(|| fail(ForumError::MissingPostIndex))?;
                    keys.push(PostKey {
                        board: thread.key.board.clone(),
                        number,
                    });
                }
                let mut posts = BTreeMap::new();
                for post in Post::load_many(&keys)? {
                    let post = post.ok_or_else(|| fail(ForumError::NotFound))?;
                    posts.insert(post.key.number, post);
                }
                let next = (end < thread.post_count).then_some(end);
                encode(&ThreadPage {
                    my_reactions: PostV1::my_reactions(context, posts.values())?,
                    posts,
                    next,
                })
            }
            "set_closed" => {
                let (value,): (bool,) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                let board = Board::load(&BoardKey {
                    slug: thread.key.board.clone(),
                })?;
                if !thread.is_moderator(context, forum.inner(), board.inner()) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                thread.closed = value;
                thread.save()?;
                encode(&(thread.key.clone(), thread.inner().clone()))
            }
            "set_pinned" => {
                let (value,): (bool,) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                let mut board = Board::load(&BoardKey {
                    slug: thread.key.board.clone(),
                })?;
                if !thread.is_moderator(context, forum.inner(), board.inner()) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                if value {
                    board.pin(thread.key.number)?;
                } else {
                    board.unpin(thread.key.number);
                }
                thread.pinned = value;
                board.save()?;
                thread.save()?;
                encode(&(thread.key.clone(), thread.inner().clone()))
            }
            "set_deleted" => {
                let (value,): (bool,) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                let board = Board::load(&BoardKey {
                    slug: thread.key.board.clone(),
                })?;
                if !thread.is_moderator(context, forum.inner(), board.inner()) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                thread.deleted = value;
                thread.save()?;
                encode(&(thread.key.clone(), thread.inner().clone()))
            }
            "set_topic" => {
                let (value,): (Option<Hash>,) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                let board = Board::load(&BoardKey {
                    slug: thread.key.board.clone(),
                })?;
                if !thread.is_moderator(context, forum.inner(), board.inner()) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                thread.topic_hash = value;
                thread.save()?;
                encode(&(thread.key.clone(), thread.inner().clone()))
            }
            "set_admin" => {
                let (value,): (Option<Esid>,) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                let board = Board::load(&BoardKey {
                    slug: thread.key.board.clone(),
                })?;
                if !thread.is_admin(context, forum.inner(), board.inner()) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                thread.admin = value;
                thread.save()?;
                encode(&(thread.key.clone(), thread.inner().clone()))
            }
            "add_moderator" => {
                let (member,): (Esid,) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                let board = Board::load(&BoardKey {
                    slug: thread.key.board.clone(),
                })?;
                if !thread.is_admin(context, forum.inner(), board.inner()) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                if !thread.moderators.contains(&member) {
                    thread.moderators.push(member);
                }
                thread.save()?;
                encode(&(thread.key.clone(), thread.inner().clone()))
            }
            "remove_moderator" => {
                let (member,): (Esid,) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                let board = Board::load(&BoardKey {
                    slug: thread.key.board.clone(),
                })?;
                if !thread.is_admin(context, forum.inner(), board.inner()) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                thread.moderators.retain(|entry| *entry != member);
                thread.save()?;
                encode(&(thread.key.clone(), thread.inner().clone()))
            }
            "ban" => {
                let (target, reason_hash, expires): (Esid, Option<Hash>, u64) =
                    decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                let board = Board::load(&BoardKey {
                    slug: thread.key.board.clone(),
                })?;
                if !thread.is_moderator(context, forum.inner(), board.inner()) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                if expires != 0 && expires <= context.time {
                    return Err(fail(ForumError::InvalidBanExpiry));
                }
                let sid = context.sid(&target)?;
                thread.bans.ban(
                    target,
                    sid,
                    BanValue {
                        reason_hash,
                        expires,
                    },
                )?;
                encode(&thread.bans.entries(None, 32)?)
            }
            "unban" => {
                let (target,): (Esid,) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                let board = Board::load(&BoardKey {
                    slug: thread.key.board.clone(),
                })?;
                if !thread.is_moderator(context, forum.inner(), board.inner()) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                let sid = context.sid(&target)?;
                thread.bans.unban(&target, &sid)?;
                encode(&thread.bans.entries(None, 32)?)
            }
            "ban_list" => {
                let (after, limit): (Option<Esid>, u32) = decode_arguments(args)?;
                encode(&thread.bans.entries(after.as_ref(), limit as usize)?)
            }
            _ => Err(ech_board_entity::unknown_function("thread", method)),
        }
    }
}
