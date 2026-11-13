use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

use ech_board_entity::{entity, Entity, Stored, WriteBatch};
use ech_db_guest::{BigMap, Bind};

use crate::component::bans::Bans;
use crate::context::Context;
use crate::entity::{Board, Forum, Read, Thread, User, Write};
use crate::error::{ForumError, Result};
use crate::types::{Esid, Hash, Sid};

#[derive(Bind, Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct PostKey {
    pub number: u64,
    pub board: String,
}

#[entity(PostKey)]
#[derive(Bind, Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub enum Post {
    V1(PostV1),
}

#[derive(Bind, Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct PostV1 {
    pub thread: u64,
    pub text_hash: Option<Hash>,
    pub media_hashes: Vec<Hash>,
    pub name_hash: Option<Hash>,
    pub deleted: bool,
    pub banned_media: Vec<Hash>,
    pub edited: bool,
    pub multi_vote: bool,
    pub votes: Vec<(Hash, u64)>,
    pub reactions: Vec<(Hash, u64)>,
    pub voted: BigMap<Sid, Vec<Hash>>,
    pub reacted: BigMap<Sid, Hash>,
    pub mod_note_hash: Option<Hash>,
    pub banned: Option<Esid>,
    pub postcount: Option<u64>,
    pub threadcount: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PostPage {
    pub post: Entity<Post>,
    pub my_reactions: BTreeMap<Hash, Hash>,
}

impl Post {
    pub(crate) fn create(
        board: &mut Write<Board>,
        thread: &mut Write<Thread>,
        text_hash: Option<Hash>,
        media_hashes: Vec<Hash>,
        name_hash: Option<Hash>,
        vote_keys: Vec<Hash>,
        multi_vote: bool,
    ) -> Result<Entity<Post>> {
        let user = User::record_post()?;
        Thread::gate(thread)?;
        let forum = Forum::current()?;
        if thread.key.board != board.key.slug {
            return Err(ForumError::NotFound);
        }
        let number = thread.key.number;
        if board.readonly && !board.is_moderator(&forum)? {
            return Err(ForumError::BoardReadOnly);
        }
        if thread.closed && !thread.is_moderator(&forum, board)? {
            return Err(ForumError::ThreadClosed);
        }
        if media_hashes.len() > board.max_media as usize {
            return Err(ForumError::TooManyAttachments);
        }
        if !vote_keys.is_empty() && !(2..=16).contains(&vote_keys.len()) {
            return Err(ForumError::InvalidPollSize);
        }
        if vote_keys.iter().collect::<HashSet<_>>().len() != vote_keys.len() {
            return Err(ForumError::DuplicatePollChoice);
        }
        if text_hash.is_none() && media_hashes.is_empty() {
            return Err(ForumError::EmptyPost);
        }
        let bump = thread.live_posts()? < board.bump_limit as u64 && !thread.pinned;
        let post_number = board.allocate_post(number, thread.bump, bump)?;
        if bump {
            thread.bump = post_number;
        }
        let mut writes = WriteBatch::new()?;
        let requests = Context::requests()?;
        let post = writes.insert(
            PostKey {
                board: board.key.slug.clone(),
                number: post_number,
            },
            Post::from(PostV1 {
                thread: number,
                text_hash,
                media_hashes,
                name_hash,
                deleted: false,
                banned_media: Vec::new(),
                edited: false,
                multi_vote,
                votes: vote_keys.into_iter().map(|key| (key, 0)).collect(),
                reactions: Vec::new(),
                voted: BigMap::new(),
                reacted: BigMap::new(),
                mod_note_hash: None,
                banned: None,
                postcount: requests.postcount.then_some(user.post_count),
                threadcount: requests.postcount.then_some(user.thread_count),
            }),
        )?;
        thread.post_count = thread
            .post_count
            .checked_add(1)
            .ok_or(ForumError::CounterOverflow)?;
        thread.posts.insert(&thread.post_count, &post_number)?;
        if post_number != number {
            thread.last_posts.push(post_number);
            if thread.last_posts.len() > 3 {
                thread.last_posts.remove(0);
            }
        }
        writes.save(thread)?;
        writes.save(board)?;
        Ok(post)
    }

    pub(crate) fn import(
        board: &mut Write<Board>,
        thread: &mut Write<Thread>,
        text_hash: Option<Hash>,
        media_hashes: Vec<Hash>,
        name_hash: Option<Hash>,
        deleted: bool,
        edited: bool,
    ) -> Result<Entity<Post>> {
        if !Context::is_server()? {
            return Err(ForumError::NotAuthorized);
        }
        let number = thread.key.number;
        let bump = thread.live_posts()? < board.bump_limit as u64 && !thread.pinned;
        let post_number = board.allocate_post(number, thread.bump, bump)?;
        if bump {
            thread.bump = post_number;
        }
        let mut writes = WriteBatch::new()?;
        let post = writes.insert(
            PostKey {
                board: board.key.slug.clone(),
                number: post_number,
            },
            Post::from(PostV1 {
                thread: number,
                text_hash,
                media_hashes,
                name_hash,
                deleted,
                banned_media: Vec::new(),
                edited,
                multi_vote: false,
                votes: Vec::new(),
                reactions: Vec::new(),
                voted: BigMap::new(),
                reacted: BigMap::new(),
                mod_note_hash: None,
                banned: None,
                postcount: None,
                threadcount: None,
            }),
        )?;
        thread.post_count = thread
            .post_count
            .checked_add(1)
            .ok_or(ForumError::CounterOverflow)?;
        if deleted {
            thread.add_deleted()?;
        }
        thread.posts.insert(&thread.post_count, &post_number)?;
        if post_number != number {
            thread.last_posts.push(post_number);
            if thread.last_posts.len() > 3 {
                thread.last_posts.remove(0);
            }
        }
        writes.save(thread)?;
        writes.save(board)?;
        Ok(post)
    }

    pub(crate) fn my_reactions<'a>(
        posts: impl IntoIterator<Item = &'a Entity<Post>>,
    ) -> Result<BTreeMap<Hash, Hash>> {
        if Context::is_server()? {
            return Ok(BTreeMap::new());
        }
        let sid = Context::author_sid()?;
        let posts: Vec<_> = posts
            .into_iter()
            .filter(|post| !post.reactions.is_empty())
            .collect();
        let entries: Vec<_> = posts.iter().map(|post| (&post.reacted, &sid)).collect();
        let reactions = BigMap::get_batch(entries.as_slice())?;
        Ok(posts
            .into_iter()
            .zip(reactions)
            .filter_map(|(post, reaction)| reaction.map(|reaction| (Post::id(&post.key), reaction)))
            .collect())
    }

    pub(crate) fn set_media(
        post: &mut Entity<Post>,
        hashes: Vec<Hash>,
        ban: bool,
    ) -> Result<&Entity<Post>> {
        Self::gate(post)?;
        let forum = Forum::current()?;
        let board = Board::open(post.key.board.clone())?;
        let thread = Thread::open(post.key.board.clone(), post.thread)?;
        let moderator = thread.is_moderator(&forum, &board)?;
        if !(moderator || (ban && thread.is_author(post)?)) {
            return Err(ForumError::NotAuthorized);
        }
        if ban {
            for hash in &hashes {
                if !post.media_hashes.contains(hash) {
                    return Err(ForumError::MediaNotFound);
                }
            }
        }
        for hash in hashes {
            if ban {
                if post.banned_media.contains(&hash) {
                    return Err(ForumError::MediaAlreadyBanned);
                }
                post.banned_media.push(hash);
            } else {
                let index = post
                    .banned_media
                    .iter()
                    .position(|entry| *entry == hash)
                    .ok_or(ForumError::MediaNotBanned)?;
                post.banned_media.remove(index);
            }
        }
        post.save()?;
        Ok(post)
    }

    pub(crate) fn gate(post: &Entity<Post>) -> Result<()> {
        let thread = Thread::open(post.key.board.clone(), post.thread)?;
        let board = Board::open(post.key.board.clone())?;
        let forum = Forum::current()?;
        let mut bans = vec![&thread.bans, &board.bans];
        if !board.ignore_forum_bans {
            bans.push(&forum.bans);
        }
        Bans::gate(&bans)
    }

    pub(crate) fn get(post: &Read<Post>) -> Result<PostPage> {
        Ok(PostPage {
            my_reactions: Post::my_reactions(std::iter::once(&**post))?,
            post: (**post).clone(),
        })
    }

    pub(crate) fn set_text(
        post: &mut Write<Post>,
        text_hash: Option<Hash>,
    ) -> Result<&Entity<Post>> {
        Self::gate(post)?;
        let forum = Forum::current()?;
        let board = Board::open(post.key.board.clone())?;
        let thread = Thread::open(post.key.board.clone(), post.thread)?;
        if !thread.is_moderator(&forum, &board)? && !thread.is_author(post)? {
            return Err(ForumError::NotAuthorized);
        }
        post.text_hash = text_hash;
        post.edited = true;
        if post.text_hash.is_none() && post.media_hashes.is_empty() && !post.deleted {
            Self::set_deleted(post, true)?;
        } else {
            post.save()?;
        }
        Ok(post)
    }

    pub(crate) fn set_deleted(post: &mut Write<Post>, deleted: bool) -> Result<&Entity<Post>> {
        Self::gate(post)?;
        let forum = Forum::current()?;
        let board = Board::open(post.key.board.clone())?;
        let mut thread = Thread::open(post.key.board.clone(), post.thread)?;
        let empty = post.text_hash.is_none() && post.media_hashes.is_empty();
        let authorized =
            thread.is_moderator(&forum, &board)? || thread.is_author(post)? || (deleted && empty);
        if !authorized {
            return Err(ForumError::NotAuthorized);
        }
        if post.deleted == deleted {
            return Err(ForumError::NoChange);
        }
        post.deleted = deleted;
        if deleted {
            thread.add_deleted()?;
        } else {
            thread.remove_deleted()?;
        }
        thread.save()?;
        post.save()?;
        Ok(post)
    }

    pub(crate) fn vote(post: &mut Write<Post>, choices: Vec<Hash>) -> Result<&Entity<Post>> {
        Self::gate(post)?;
        let sid = Context::author_sid()?;
        Thread::open(post.key.board.clone(), post.thread)?;
        if post.deleted || post.votes.len() < 2 {
            return Err(ForumError::PollUnavailable);
        }
        if choices.is_empty() || (!post.multi_vote && choices.len() != 1) {
            return Err(ForumError::InvalidVoteCount);
        }
        if choices.iter().collect::<HashSet<_>>().len() != choices.len() {
            return Err(ForumError::DuplicatePollChoice);
        }
        if post.voted.get(&sid)?.is_some() {
            return Err(ForumError::AlreadyVoted);
        }
        for choice in &choices {
            let entry = post
                .votes
                .iter_mut()
                .find(|(hash, _)| hash == choice)
                .ok_or(ForumError::InvalidPollChoice)?;
            entry.1 = entry.1.checked_add(1).ok_or(ForumError::CounterOverflow)?;
        }
        post.voted.insert(&sid, &choices)?;
        post.save()?;
        Ok(post)
    }

    pub(crate) fn react(
        post: &mut Write<Post>,
        old: Option<Hash>,
        reaction: Hash,
    ) -> Result<&Entity<Post>> {
        Self::gate(post)?;
        let sid = Context::author_sid()?;
        let board = Board::open(post.key.board.clone())?;
        let _thread = Thread::open(post.key.board.clone(), post.thread)?;
        if !board.reactions.contains(&reaction) {
            return Err(ForumError::ReactionNotAllowed);
        }
        if post.deleted {
            return Err(ForumError::PostDeleted);
        }
        let previous = post.reacted.get(&sid)?;
        if previous != old {
            return Err(ForumError::ReactionConflict);
        }
        if let Some(previous) = previous {
            let entry = post
                .reactions
                .iter_mut()
                .find(|(hash, _)| *hash == previous)
                .ok_or(ForumError::InvalidReactionCount)?;
            entry.1 = entry
                .1
                .checked_sub(1)
                .ok_or(ForumError::InvalidReactionCount)?;
            if entry.1 == 0 {
                post.reactions.retain(|(hash, _)| *hash != previous);
            }
            post.reacted.remove(&sid)?;
        }
        if previous != Some(reaction) {
            match post
                .reactions
                .iter_mut()
                .find(|(hash, _)| *hash == reaction)
            {
                Some(entry) => {
                    entry.1 = entry.1.checked_add(1).ok_or(ForumError::CounterOverflow)?;
                }
                None => post.reactions.push((reaction, 1)),
            }
            post.reacted.insert(&sid, &reaction)?;
        }
        post.save()?;
        Ok(post)
    }

    pub(crate) fn ban_media(post: &mut Write<Post>, hashes: Vec<Hash>) -> Result<&Entity<Post>> {
        Self::set_media(post, hashes, true)
    }

    pub(crate) fn unban_media(post: &mut Write<Post>, hashes: Vec<Hash>) -> Result<&Entity<Post>> {
        Self::set_media(post, hashes, false)
    }

    pub(crate) fn set_banned(
        post: &mut Write<Post>,
        banned: Option<Esid>,
    ) -> Result<&Entity<Post>> {
        Self::gate(post)?;
        let forum = Forum::current()?;
        let board = Board::open(post.key.board.clone())?;
        let thread = Thread::open(post.key.board.clone(), post.thread)?;
        if !thread.is_moderator(&forum, &board)? {
            return Err(ForumError::NotAuthorized);
        }
        post.banned = banned;
        post.save()?;
        Ok(post)
    }

    pub(crate) fn set_mod_note(
        post: &mut Write<Post>,
        value: Option<Hash>,
    ) -> Result<&Entity<Post>> {
        Self::gate(post)?;
        let forum = Forum::current()?;
        let board = Board::open(post.key.board.clone())?;
        let thread = Thread::open(post.key.board.clone(), post.thread)?;
        if !thread.is_moderator(&forum, &board)? {
            return Err(ForumError::NotAuthorized);
        }
        post.mod_note_hash = value;
        post.save()?;
        Ok(post)
    }
}
