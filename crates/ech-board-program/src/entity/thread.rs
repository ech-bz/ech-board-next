use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use ech_board_entity::{entity, profile, Entity};
use ech_db_guest::Author;
use ech_db_guest::BigMap;
use ech_db_guest::Bind;

use crate::component::bans::{BanValue, Bans};
use crate::component::board_index::BoardOrderKey;
use crate::context::{Context, ServerContext};
use crate::entity::{Board, Forum, Post, PostKey, Read, User, Write};
use crate::error::{ForumError, Result};
use crate::types::{Esid, Hash, EDIT_WINDOW_MS};

pub const PAGE_POSTS: u64 = 1024;

#[derive(Bind, Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct ThreadKey {
    pub number: u64,
    pub board: String,
}

#[entity(ThreadKey)]
#[derive(Bind, Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
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
    pub posts: BigMap<u64, u64>,
    pub bans: Bans,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ThreadPage {
    pub my_reactions: BTreeMap<Hash, Hash>,
    pub posts: BTreeMap<u64, Entity<Post>>,
    pub next: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ThreadMeta<T = Entity<Thread>> {
    pub thread: T,
    pub page_size: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ThreadPreview {
    pub thread: Entity<Thread>,
    pub posts: BTreeMap<u64, Entity<Post>>,
}

impl Thread {
    pub(crate) fn is_moderator(&self, forum: &Forum, board: &Board) -> Result<bool> {
        let value = match self {
            Self::V1(value) => value,
        };
        if board.is_moderator(forum)? {
            return Ok(true);
        }
        for esid in &value.moderators {
            if Context::is_author(esid)? {
                return Ok(true);
            }
        }
        if let Some(admin) = &value.admin {
            if Context::is_author(admin)? {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub(crate) fn is_admin(&self, forum: &Forum, board: &Board) -> Result<bool> {
        let value = match self {
            Self::V1(value) => value,
        };
        let board = match board {
            Board::V1(board) => board,
        };
        if forum.is_moderator()? {
            return Ok(true);
        }
        for esid in &board.moderators {
            if Context::is_author(esid)? {
                return Ok(true);
            }
        }
        if let Some(admin) = &value.admin {
            if Context::is_author(admin)? {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub(crate) fn is_author(&self, post: &Entity<Post>) -> Result<bool> {
        let author = match &post.genesis.user.author {
            Author::User { esid, .. } => *esid,
            Author::Server => return Ok(false),
        };
        let created = ServerContext::decode(&post.genesis.server.ctx)?.time;
        let time = Context::time()?;
        Ok(Context::is_author(&author)? && time >= created && time - created <= EDIT_WINDOW_MS)
    }

    pub(crate) fn create(
        board: &mut Write<Board>,
        topic_hash: Option<Hash>,
        text_hash: Option<Hash>,
        media_hashes: Vec<Hash>,
        name_hash: Option<Hash>,
        vote_keys: Vec<Hash>,
        multi_vote: bool,
        self_admin: bool,
    ) -> Result<Entity<Thread>> {
        User::record_thread()?;
        if board.max_media != 0 && media_hashes.is_empty() {
            return Err(ForumError::PostRequiresMedia);
        }
        let admin = if self_admin {
            Some(Context::esid()?)
        } else {
            None
        };
        let number = board
            .post_count
            .checked_add(1)
            .ok_or(ForumError::CounterOverflow)?;
        let mut thread = Write::from(Entity::<Self>::insert(
            ThreadKey {
                board: board.key.slug.clone(),
                number,
            },
            Thread::from(ThreadV1 {
                topic_hash,
                closed: false,
                pinned: false,
                deleted: false,
                post_count: 0,
                bump: number,
                last_posts: Vec::new(),
                admin,
                moderators: Vec::new(),
                posts: BigMap::new(),
                bans: Bans::default(),
            }),
        )?);
        board.thread_count = board
            .thread_count
            .checked_add(1)
            .ok_or(ForumError::CounterOverflow)?;
        board
            .order
            .replace(None, BoardOrderKey::new(number, number))?;
        Post::create(
            board,
            &mut thread,
            text_hash,
            media_hashes,
            name_hash,
            vote_keys,
            multi_vote,
        )?;
        Ok(thread.into_inner())
    }

    pub(crate) fn import(
        board: &mut Write<Board>,
        topic_hash: Option<Hash>,
        text_hash: Option<Hash>,
        media_hashes: Vec<Hash>,
        name_hash: Option<Hash>,
        closed: bool,
        deleted: bool,
    ) -> Result<Entity<Thread>> {
        if !Context::is_server()? {
            return Err(ForumError::NotAuthorized);
        }
        let number = board
            .post_count
            .checked_add(1)
            .ok_or(ForumError::CounterOverflow)?;
        let mut thread = Write::from(Entity::<Self>::insert(
            ThreadKey {
                board: board.key.slug.clone(),
                number,
            },
            Thread::from(ThreadV1 {
                topic_hash,
                closed,
                pinned: false,
                deleted,
                post_count: 0,
                bump: number,
                last_posts: Vec::new(),
                admin: None,
                moderators: Vec::new(),
                posts: BigMap::new(),
                bans: Bans::default(),
            }),
        )?);
        board.thread_count = board
            .thread_count
            .checked_add(1)
            .ok_or(ForumError::CounterOverflow)?;
        board
            .order
            .replace(None, BoardOrderKey::new(number, number))?;
        Post::import(
            board,
            &mut thread,
            text_hash,
            media_hashes,
            name_hash,
            deleted,
            false,
        )?;
        Ok(thread.into_inner())
    }

    pub(crate) fn previews(threads: Vec<Entity<Thread>>) -> Result<Vec<ThreadPreview>> {
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
        let mut loaded = Entity::<Post>::load_many(&keys)?.into_iter();
        threads
            .into_iter()
            .map(|thread| {
                let mut posts = BTreeMap::new();
                for _ in 0..=thread.last_posts.len() {
                    let post = loaded.next().flatten().ok_or(ForumError::NotFound)?;
                    posts.insert(post.key.number, post);
                }
                Ok(ThreadPreview { thread, posts })
            })
            .collect()
    }

    pub(crate) fn gate(thread: &Entity<Thread>) -> Result<()> {
        let board = Board::open(thread.key.board.clone())?;
        let forum = Forum::current()?;
        let mut bans = vec![&thread.bans, &board.bans];
        if !board.ignore_forum_bans {
            bans.push(&forum.bans);
        }
        Bans::gate(&bans)
    }

    pub(crate) fn meta(thread: &Read<Thread>) -> Result<ThreadMeta<&Entity<Thread>>> {
        Ok(ThreadMeta {
            thread: &**thread,
            page_size: PAGE_POSTS,
        })
    }

    pub(crate) fn open(board: String, number: u64) -> Result<Entity<Thread>> {
        Ok(Entity::<Self>::load(&ThreadKey { board, number })?)
    }

    pub(crate) fn page(thread: &Read<Thread>, after: u64) -> Result<ThreadPage> {
        let end = thread.post_count.min(after.saturating_add(PAGE_POSTS));
        let count = end.saturating_sub(after) as usize;
        let before = end.checked_add(1);
        let entries = thread.posts.range(Some(&after), before.as_ref(), count)?;
        if entries.len() != count {
            return Err(ForumError::MissingPostIndex);
        }
        let mut keys = Vec::with_capacity(count);
        for (offset, (sequence, number)) in entries.into_iter().enumerate() {
            if sequence != after + offset as u64 + 1 {
                return Err(ForumError::MissingPostIndex);
            }
            keys.push(PostKey {
                board: thread.key.board.clone(),
                number,
            });
        }
        let loaded = Entity::<Post>::load_many(&keys)?;
        let posts = profile::measure("page_assemble", || {
            let mut posts = BTreeMap::new();
            for post in loaded {
                let post = post.ok_or(ForumError::NotFound)?;
                posts.insert(post.key.number, post);
            }
            Ok::<_, ForumError>(posts)
        })?;
        let next = (end < thread.post_count).then_some(end);
        let page = ThreadPage {
            my_reactions: Post::my_reactions(posts.values())?,
            posts,
            next,
        };
        Ok(page)
    }
    pub(crate) fn set_closed(thread: &mut Write<Thread>, value: bool) -> Result<&Entity<Thread>> {
        Self::gate(thread)?;
        let forum = Forum::current()?;
        let board = Board::open(thread.key.board.clone())?;
        if !thread.is_moderator(&forum, &board)? {
            return Err(ForumError::NotAuthorized);
        }
        thread.closed = value;
        thread.save()?;
        Ok(thread)
    }

    pub(crate) fn set_pinned(thread: &mut Write<Thread>, value: bool) -> Result<&Entity<Thread>> {
        Self::gate(thread)?;
        let forum = Forum::current()?;
        let mut board = Board::open(thread.key.board.clone())?;
        if !thread.is_moderator(&forum, &board)? {
            return Err(ForumError::NotAuthorized);
        }
        if value {
            board.pin(thread.key.number)?;
        } else {
            board.unpin(thread.key.number);
        }
        thread.pinned = value;
        board.save()?;
        thread.save()?;
        Ok(thread)
    }

    pub(crate) fn set_deleted(thread: &mut Write<Thread>, value: bool) -> Result<&Entity<Thread>> {
        Self::gate(thread)?;
        let forum = Forum::current()?;
        let board = Board::open(thread.key.board.clone())?;
        if !thread.is_moderator(&forum, &board)? {
            return Err(ForumError::NotAuthorized);
        }
        thread.deleted = value;
        thread.save()?;
        Ok(thread)
    }

    pub(crate) fn set_topic(
        thread: &mut Write<Thread>,
        value: Option<Hash>,
    ) -> Result<&Entity<Thread>> {
        Self::gate(thread)?;
        let forum = Forum::current()?;
        let board = Board::open(thread.key.board.clone())?;
        if !thread.is_moderator(&forum, &board)? {
            return Err(ForumError::NotAuthorized);
        }
        thread.topic_hash = value;
        thread.save()?;
        Ok(thread)
    }

    pub(crate) fn set_admin(
        thread: &mut Write<Thread>,
        value: Option<Esid>,
    ) -> Result<&Entity<Thread>> {
        Self::gate(thread)?;
        let forum = Forum::current()?;
        let board = Board::open(thread.key.board.clone())?;
        if !thread.is_admin(&forum, &board)? {
            return Err(ForumError::NotAuthorized);
        }
        thread.admin = value;
        thread.save()?;
        Ok(thread)
    }

    pub(crate) fn add_moderator(
        thread: &mut Write<Thread>,
        member: Esid,
    ) -> Result<&Entity<Thread>> {
        Self::gate(thread)?;
        let forum = Forum::current()?;
        let board = Board::open(thread.key.board.clone())?;
        if !thread.is_admin(&forum, &board)? {
            return Err(ForumError::NotAuthorized);
        }
        if !thread.moderators.contains(&member) {
            thread.moderators.push(member);
        }
        thread.save()?;
        Ok(thread)
    }

    pub(crate) fn remove_moderator(
        thread: &mut Write<Thread>,
        member: Esid,
    ) -> Result<&Entity<Thread>> {
        Self::gate(thread)?;
        let forum = Forum::current()?;
        let board = Board::open(thread.key.board.clone())?;
        if !thread.is_admin(&forum, &board)? {
            return Err(ForumError::NotAuthorized);
        }
        thread.moderators.retain(|entry| *entry != member);
        thread.save()?;
        Ok(thread)
    }

    pub(crate) fn ban(
        thread: &mut Write<Thread>,
        target: Esid,
        reason_hash: Option<Hash>,
        expires: u64,
    ) -> Result<Vec<(Esid, BanValue)>> {
        Self::gate(thread)?;
        let forum = Forum::current()?;
        let board = Board::open(thread.key.board.clone())?;
        if !thread.is_moderator(&forum, &board)? {
            return Err(ForumError::NotAuthorized);
        }
        if expires != 0 && expires <= Context::time()? {
            return Err(ForumError::InvalidBanExpiry);
        }
        let sid = Context::sid(&target)?;
        thread.bans.ban(
            target,
            sid,
            BanValue {
                reason_hash,
                expires,
            },
        )?;
        thread.bans.entries(None, 32)
    }

    pub(crate) fn unban(thread: &mut Write<Thread>, target: Esid) -> Result<Vec<(Esid, BanValue)>> {
        Self::gate(thread)?;
        let forum = Forum::current()?;
        let board = Board::open(thread.key.board.clone())?;
        if !thread.is_moderator(&forum, &board)? {
            return Err(ForumError::NotAuthorized);
        }
        let sid = Context::sid(&target)?;
        thread.bans.unban(&target, &sid)?;
        thread.bans.entries(None, 32)
    }

    pub(crate) fn ban_list(
        thread: &Read<Thread>,
        after: Option<Esid>,
        limit: u32,
    ) -> Result<Vec<(Esid, BanValue)>> {
        thread.bans.entries(after.as_ref(), limit as usize)
    }
}
