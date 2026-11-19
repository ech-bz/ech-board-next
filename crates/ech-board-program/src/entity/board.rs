use std::collections::{BTreeMap, BTreeSet, HashSet};

use serde::{Deserialize, Serialize};

use ech_board_entity::{entity, Entity};
use ech_db_guest::{Bind, Txid};

use crate::component::bans::{Ban, BanScope, Bans, BansGate};
use crate::component::board_index::{BoardIndex, BoardOrderKey};
use crate::component::permissions::Permissions;
use crate::context::Context;
use crate::entity::{
    transactions, Forum, Page, Post, Read, Thread, ThreadKey, ThreadPreview, Write,
};
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
    pub post_rate_limit_ms: u32,
    pub reaction_rate_limit_ms: u32,
    pub pow_bits: u8,
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
    pub bans: BTreeMap<BanScope, Vec<Txid>>,
    pub threads: Vec<ThreadPreview>,
    pub next: Option<BoardCursor>,
}

impl Board {
    pub(crate) fn permissions(&self, forum: &Forum) -> Permissions {
        let permissions = forum.permissions();
        if permissions != Permissions::User {
            return permissions;
        }
        if Context::is_author_any(&self.moderators) {
            return Permissions::BoardMod;
        }
        Permissions::User
    }

    pub(crate) fn allocate_post(
        &mut self,
        thread: u64,
        previous_bump: u64,
        bump: bool,
    ) -> Result<u64> {
        let post_count = self
            .post_count
            .checked_add(1)
            .ok_or(ForumError::CounterOverflow)?;
        self.post_count = post_count;
        if bump {
            self.order.replace(
                Some(BoardOrderKey::new(thread, previous_bump)),
                BoardOrderKey::new(thread, post_count),
            )?;
        }
        Ok(post_count)
    }

    pub(crate) fn pin(&mut self, number: u64) -> Result<()> {
        if self.pinned.len() >= PINNED_LIMIT && !self.pinned.contains(&number) {
            return Err(ForumError::PinnedThreadLimit);
        }
        if !self.pinned.contains(&number) {
            self.pinned.push(number);
        }
        Ok(())
    }

    pub(crate) fn unpin(&mut self, number: u64) {
        self.pinned.retain(|entry| *entry != number);
    }

    fn paginate(&self, cursor: Option<BoardCursor>) -> Result<(Vec<u64>, Option<BoardCursor>)> {
        let pinned = cursor
            .as_ref()
            .map_or(&self.pinned, |cursor| &cursor.pinned);
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
        Forum::check_bans(forum)?;
        if forum.permissions() < Permissions::ForumMod {
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
                post_rate_limit_ms: 0,
                reaction_rate_limit_ms: 0,
                pow_bits: 0,
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

    pub(crate) fn check_bans(board: &Entity<Board>) -> Result<()> {
        let forum = Forum::current()?;
        let permissions = board.permissions(&forum);
        let mut bans = Vec::new();
        if permissions < Permissions::ForumMod {
            bans.push(&board.bans);
        }
        if !board.ignore_forum_bans {
            bans.push(&forum.bans);
        }
        bans.check_bans()
    }

    pub(crate) fn open(slug: String) -> Result<Entity<Board>> {
        Ok(Entity::<Self>::load(&BoardKey { slug })?)
    }

    pub(crate) fn meta(board: &Read<Board>) -> Result<Page<Entity<Board>>> {
        let entity = (**board).clone();
        let transactions = transactions(vec![entity.genesis])?;
        Ok(Page {
            view: entity,
            threads: Vec::new(),
            transactions,
        })
    }

    pub(crate) fn page(
        board: &Read<Board>,
        cursor: Option<BoardCursor>,
    ) -> Result<Page<BoardPage>> {
        let (numbers, next) = board.paginate(cursor)?;
        let threads = Self::previews(board, &numbers)?;
        let forum = Forum::current()?;
        let mut bans: BTreeMap<BanScope, Vec<Txid>> = BTreeMap::new();
        for preview in &threads {
            let own: Vec<Txid> = preview.posts.values().map(|post| post.genesis).collect();
            for (scope, found) in Bans::filter(&forum, board, &preview.thread, &own)? {
                bans.entry(scope).or_default().extend(found);
            }
        }
        let mut txids = Vec::new();
        let mut entries = Vec::with_capacity(threads.len());
        for thread in &threads {
            txids.push(thread.thread.genesis);
            entries.push((
                thread.thread.id(),
                bcs::to_bytes(&thread.thread).expect("thread encodes"),
            ));
            for post in thread.posts.values() {
                txids.push(post.genesis);
            }
        }
        Ok(Page {
            view: BoardPage {
                my_reactions: Post::my_reactions(
                    threads.iter().flat_map(|thread| thread.posts.values()),
                )?,
                bans,
                threads,
                next,
            },
            threads: entries,
            transactions: transactions(txids)?,
        })
    }

    pub(crate) fn add_moderator(board: &mut Write<Board>, member: Esid) -> Result<()> {
        Self::check_bans(board)?;
        if Forum::current()?.permissions() < Permissions::ForumMod {
            return Err(ForumError::NotAuthorized);
        }
        if !board.moderators.contains(&member) {
            board.moderators.push(member);
        }
        board.save()?;
        Ok(())
    }

    pub(crate) fn remove_moderator(board: &mut Write<Board>, member: Esid) -> Result<()> {
        Self::check_bans(board)?;
        if Forum::current()?.permissions() < Permissions::ForumMod {
            return Err(ForumError::NotAuthorized);
        }
        board.moderators.retain(|entry| *entry != member);
        board.save()?;
        Ok(())
    }

    pub(crate) fn ban(
        board: &mut Write<Board>,
        target: Txid,
        reason_hash: Option<Hash>,
        expires: Option<u64>,
    ) -> Result<()> {
        Self::check_bans(board)?;
        if board.permissions(&*Forum::current()?) < Permissions::BoardMod {
            return Err(ForumError::NotAuthorized);
        }
        let now = Context::time();
        if expires.is_some_and(|expires| expires <= now) {
            return Err(ForumError::InvalidBanExpiry);
        }
        board.bans.ban(
            Ban {
                target,
                reason_hash,
                expires,
            },
            now,
        )?;
        Ok(())
    }

    pub(crate) fn unban(board: &mut Write<Board>, target: Txid) -> Result<()> {
        Self::check_bans(board)?;
        if board.permissions(&*Forum::current()?) < Permissions::BoardMod {
            return Err(ForumError::NotAuthorized);
        }
        board.bans.unban(target)?;
        Ok(())
    }

    pub(crate) fn ban_list(
        board: &Read<Board>,
        after: Option<Txid>,
        limit: u32,
    ) -> Result<Vec<Ban>> {
        board.bans.list(after.as_ref(), limit as usize)
    }

    pub(crate) fn set_readonly(board: &mut Write<Board>, value: bool) -> Result<()> {
        Self::check_bans(board)?;
        if Forum::current()?.permissions() < Permissions::ForumMod {
            return Err(ForumError::NotAuthorized);
        }
        board.readonly = value;
        board.save()?;
        Ok(())
    }

    pub(crate) fn set_bump_limit(board: &mut Write<Board>, value: u32) -> Result<()> {
        Self::check_bans(board)?;
        if Forum::current()?.permissions() < Permissions::ForumMod {
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
        Self::check_bans(board)?;
        if Forum::current()?.permissions() < Permissions::ForumMod {
            return Err(ForumError::NotAuthorized);
        }
        if value > 16 {
            return Err(ForumError::InvalidMaxMedia);
        }
        board.max_media = value;
        board.save()?;
        Ok(())
    }

    pub(crate) fn set_post_rate_limit(board: &mut Write<Board>, value: u32) -> Result<()> {
        Self::check_bans(board)?;
        if Forum::current()?.permissions() < Permissions::ForumMod {
            return Err(ForumError::NotAuthorized);
        }
        board.post_rate_limit_ms = value;
        board.save()?;
        Ok(())
    }

    pub(crate) fn set_reaction_rate_limit(board: &mut Write<Board>, value: u32) -> Result<()> {
        Self::check_bans(board)?;
        if Forum::current()?.permissions() < Permissions::ForumMod {
            return Err(ForumError::NotAuthorized);
        }
        board.reaction_rate_limit_ms = value;
        board.save()?;
        Ok(())
    }

    pub(crate) fn set_pow_bits(board: &mut Write<Board>, value: u8) -> Result<()> {
        Self::check_bans(board)?;
        if Forum::current()?.permissions() < Permissions::ForumMod {
            return Err(ForumError::NotAuthorized);
        }
        board.pow_bits = value;
        board.save()?;
        Ok(())
    }

    pub(crate) fn set_description(board: &mut Write<Board>, value: Option<Hash>) -> Result<()> {
        Self::check_bans(board)?;
        if board.permissions(&*Forum::current()?) < Permissions::BoardMod {
            return Err(ForumError::NotAuthorized);
        }
        board.description_hash = value;
        board.save()?;
        Ok(())
    }

    pub(crate) fn set_ignore_forum_bans(board: &mut Write<Board>, value: bool) -> Result<()> {
        Self::check_bans(board)?;
        if Forum::current()?.permissions() < Permissions::ForumMod {
            return Err(ForumError::NotAuthorized);
        }
        board.ignore_forum_bans = value;
        board.save()?;
        Ok(())
    }

    pub(crate) fn set_reactions(board: &mut Write<Board>, values: Vec<Hash>) -> Result<()> {
        Self::check_bans(board)?;
        if board.permissions(&*Forum::current()?) < Permissions::BoardMod {
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
        Self::check_bans(board)?;
        if board.permissions(&*Forum::current()?) < Permissions::BoardMod {
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
