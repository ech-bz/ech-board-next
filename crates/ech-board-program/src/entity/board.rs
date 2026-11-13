use std::collections::{BTreeMap, BTreeSet, HashSet};

use serde::{Deserialize, Serialize};

use ech_board_entity::{entity, Entity};
use ech_db_guest::Bind;

use crate::component::bans::{BanValue, Bans};
use crate::component::board_index::{BoardIndex, BoardOrderKey};
use crate::context::Context;
use crate::entity::{Forum, Post, Read, Thread, ThreadKey, ThreadPreview, Write};
use crate::error::{ForumError, Result};
use crate::types::{Esid, Hash};

const PAGE_THREADS: usize = 20;
const PINNED_LIMIT: usize = 8;

#[derive(Bind, Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct BoardKey {
    pub slug: String,
}

#[entity(BoardKey)]
#[derive(Bind, Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
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
    pub order: BoardIndex,
    pub bans: Bans,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct BoardCursor {
    pub root: u64,
    pub before: BoardOrderKey,
    pub pinned: Vec<u64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct BoardPage {
    pub my_reactions: BTreeMap<Hash, Hash>,
    pub threads: Vec<ThreadPreview>,
    pub next: Option<BoardCursor>,
}

impl Board {
    pub(crate) fn is_moderator(&self, forum: &Forum) -> Result<bool> {
        if forum.is_moderator()? {
            return Ok(true);
        }
        for esid in &self.moderators {
            if Context::is_author(esid)? {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub(crate) fn allocate_post(
        &mut self,
        thread: u64,
        previous_bump: u64,
        bump: bool,
    ) -> Result<u64> {
        let value = match self {
            Self::V1(value) => value,
        };
        value.post_count = value
            .post_count
            .checked_add(1)
            .ok_or(ForumError::CounterOverflow)?;
        if bump {
            value.order.replace(
                Some(BoardOrderKey::new(thread, previous_bump)),
                BoardOrderKey::new(thread, value.post_count),
            )?;
        }
        Ok(value.post_count)
    }

    pub(crate) fn pin(&mut self, number: u64) -> Result<()> {
        let value = match self {
            Self::V1(value) => value,
        };
        if value.pinned.len() >= PINNED_LIMIT && !value.pinned.contains(&number) {
            return Err(ForumError::PinnedThreadLimit);
        }
        if !value.pinned.contains(&number) {
            value.pinned.push(number);
        }
        Ok(())
    }

    pub(crate) fn unpin(&mut self, number: u64) {
        let value = match self {
            Self::V1(value) => value,
        };
        value.pinned.retain(|entry| *entry != number);
    }

    fn paginate(&self, cursor: Option<BoardCursor>) -> Result<(Vec<u64>, Option<BoardCursor>)> {
        let value = match self {
            Self::V1(value) => value,
        };
        let pinned = cursor
            .as_ref()
            .map_or(&value.pinned, |cursor| &cursor.pinned);
        if pinned.len() > PINNED_LIMIT
            || pinned
                .iter()
                .enumerate()
                .any(|(index, number)| pinned[..index].contains(number))
        {
            return Err(ForumError::InvalidBoardCursor);
        }
        let mut numbers = if cursor.is_none() {
            pinned.clone()
        } else {
            Vec::new()
        };
        let remaining = PAGE_THREADS - numbers.len();
        let (root, entries) = self.order.page(
            cursor.as_ref().map(|cursor| cursor.root),
            cursor.as_ref().map(|cursor| cursor.before),
            remaining + pinned.len() + 1,
        )?;
        let entries: Vec<_> = entries
            .into_iter()
            .filter(|entry| !pinned.contains(&entry.thread))
            .collect();
        let next = (entries.len() > remaining).then(|| BoardCursor {
            root,
            before: entries[remaining - 1],
            pinned: pinned.clone(),
        });
        numbers.extend(
            entries
                .into_iter()
                .take(remaining)
                .map(|entry| entry.thread),
        );
        Ok((numbers, next))
    }

    pub(crate) fn create(
        forum: &mut Write<Forum>,
        slug: String,
        description_hash: Option<Hash>,
    ) -> Result<BoardKey> {
        Bans::gate(&[&forum.bans])?;
        if !forum.is_moderator()? {
            return Err(ForumError::NotAuthorized);
        }
        if slug.is_empty()
            || slug.len() > 32
            || !slug
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        {
            return Err(ForumError::InvalidBoardSlug);
        }
        if Entity::<Self>::load(&BoardKey { slug: slug.clone() }).is_ok() {
            return Err(ForumError::BoardExists);
        }
        let board = Entity::<Self>::insert(
            BoardKey { slug },
            Board::from(BoardV1 {
                description_hash,
                readonly: false,
                bump_limit: 500,
                max_media: 4,
                thread_count: 0,
                post_count: 0,
                pinned: Vec::new(),
                reactions: Vec::new(),
                moderators: Vec::new(),
                ignore_forum_bans: false,
                order: BoardIndex::default(),
                bans: Bans::default(),
            }),
        )?;
        forum.boards.push(&board.key)?;
        forum.save()?;
        Ok(board.key)
    }

    pub(crate) fn gate(board: &Entity<Board>) -> Result<()> {
        let forum = Self::forum()?;
        let mut bans = vec![&board.bans];
        if !board.ignore_forum_bans {
            bans.push(&forum.bans);
        }
        Bans::gate(&bans)
    }

    fn forum() -> Result<Entity<Forum>> {
        Forum::current()
    }

    pub(crate) fn open(slug: String) -> Result<Entity<Board>> {
        Ok(Entity::<Self>::load(&BoardKey { slug })?)
    }

    pub(crate) fn meta(board: &Read<Board>) -> Result<&Entity<Board>> {
        Ok(board)
    }

    pub(crate) fn page(board: &Read<Board>, cursor: Option<BoardCursor>) -> Result<BoardPage> {
        let (numbers, next) = board.paginate(cursor)?;
        let threads = Self::previews(board, &numbers)?;
        Ok(BoardPage {
            my_reactions: Post::my_reactions(
                threads.iter().flat_map(|thread| thread.posts.values()),
            )?,
            threads,
            next,
        })
    }

    pub(crate) fn add_moderator(board: &mut Write<Board>, member: Esid) -> Result<()> {
        Self::gate(board)?;
        if !Self::forum()?.is_moderator()? {
            return Err(ForumError::NotAuthorized);
        }
        if !board.moderators.contains(&member) {
            board.moderators.push(member);
        }
        board.save()?;
        Ok(())
    }

    pub(crate) fn remove_moderator(board: &mut Write<Board>, member: Esid) -> Result<()> {
        Self::gate(board)?;
        if !Self::forum()?.is_moderator()? {
            return Err(ForumError::NotAuthorized);
        }
        board.moderators.retain(|entry| *entry != member);
        board.save()?;
        Ok(())
    }

    pub(crate) fn ban(
        board: &mut Write<Board>,
        target: Esid,
        reason_hash: Option<Hash>,
        expires: u64,
    ) -> Result<()> {
        Self::gate(board)?;
        if !board.is_moderator(&*Self::forum()?)? {
            return Err(ForumError::NotAuthorized);
        }
        if expires != 0 && expires <= Context::time()? {
            return Err(ForumError::InvalidBanExpiry);
        }
        let sid = Context::sid(&target)?;
        board.bans.ban(
            target,
            sid,
            BanValue {
                reason_hash,
                expires,
            },
        )?;
        Ok(())
    }

    pub(crate) fn unban(board: &mut Write<Board>, target: Esid) -> Result<()> {
        Self::gate(board)?;
        if !board.is_moderator(&*Self::forum()?)? {
            return Err(ForumError::NotAuthorized);
        }
        let sid = Context::sid(&target)?;
        board.bans.unban(&target, &sid)?;
        Ok(())
    }

    pub(crate) fn ban_list(
        board: &Read<Board>,
        after: Option<Esid>,
        limit: u32,
    ) -> Result<Vec<(Esid, BanValue)>> {
        board.bans.entries(after.as_ref(), limit as usize)
    }

    pub(crate) fn set_readonly(board: &mut Write<Board>, value: bool) -> Result<()> {
        Self::gate(board)?;
        if !Self::forum()?.is_moderator()? {
            return Err(ForumError::NotAuthorized);
        }
        board.readonly = value;
        board.save()?;
        Ok(())
    }

    pub(crate) fn set_bump_limit(board: &mut Write<Board>, value: u32) -> Result<()> {
        Self::gate(board)?;
        if !Self::forum()?.is_moderator()? {
            return Err(ForumError::NotAuthorized);
        }
        if value == 0 {
            return Err(ForumError::InvalidBumpLimit);
        }
        board.bump_limit = value;
        board.save()?;
        Ok(())
    }

    pub(crate) fn set_max_media(board: &mut Write<Board>, value: u8) -> Result<()> {
        Self::gate(board)?;
        if !Self::forum()?.is_moderator()? {
            return Err(ForumError::NotAuthorized);
        }
        if value > 16 {
            return Err(ForumError::InvalidMaxMedia);
        }
        board.max_media = value;
        board.save()?;
        Ok(())
    }

    pub(crate) fn set_description(board: &mut Write<Board>, value: Option<Hash>) -> Result<()> {
        Self::gate(board)?;
        if !board.is_moderator(&*Self::forum()?)? {
            return Err(ForumError::NotAuthorized);
        }
        board.description_hash = value;
        board.save()?;
        Ok(())
    }

    pub(crate) fn set_ignore_forum_bans(board: &mut Write<Board>, value: bool) -> Result<()> {
        Self::gate(board)?;
        if !board.is_moderator(&*Self::forum()?)? {
            return Err(ForumError::NotAuthorized);
        }
        board.ignore_forum_bans = value;
        board.save()?;
        Ok(())
    }

    pub(crate) fn set_reactions(board: &mut Write<Board>, values: Vec<Hash>) -> Result<()> {
        Self::gate(board)?;
        if !board.is_moderator(&*Self::forum()?)? {
            return Err(ForumError::NotAuthorized);
        }
        if values.iter().collect::<HashSet<_>>().len() != values.len() {
            return Err(ForumError::DuplicateReaction);
        }
        board.reactions = values;
        board.save()?;
        Ok(())
    }

    pub(crate) fn set_pinned(board: &mut Write<Board>, mut values: Vec<u64>) -> Result<()> {
        Self::gate(board)?;
        if !board.is_moderator(&*Self::forum()?)? {
            return Err(ForumError::NotAuthorized);
        }
        let mut seen = BTreeSet::new();
        values.retain(|number| seen.insert(*number));
        if values.len() > PINNED_LIMIT {
            return Err(ForumError::PinnedThreadLimit);
        }
        let mut numbers = board.pinned.clone();
        numbers.extend(&values);
        numbers.sort_unstable();
        numbers.dedup();
        let keys: Vec<_> = numbers
            .iter()
            .map(|number| ThreadKey {
                board: board.key.slug.clone(),
                number: *number,
            })
            .collect();
        let threads = Entity::<Thread>::load_many(&keys)?;
        for thread in threads {
            let mut thread = thread.ok_or(ForumError::NotFound)?;
            let number = thread.key.number;
            let pinned = values.contains(&number);
            if thread.pinned != pinned {
                thread.pinned = pinned;
                thread.save()?;
            }
        }
        board.pinned = values;
        board.save()?;
        Ok(())
    }

    fn previews(board: &Entity<Board>, numbers: &[u64]) -> Result<Vec<ThreadPreview>> {
        let keys: Vec<ThreadKey> = numbers
            .iter()
            .map(|number| ThreadKey {
                board: board.key.slug.clone(),
                number: *number,
            })
            .collect();
        let mut threads = Vec::new();
        for thread in Entity::<Thread>::load_many(&keys)? {
            threads.push(thread.ok_or(ForumError::NotFound)?);
        }
        Thread::previews(threads)
    }
}
