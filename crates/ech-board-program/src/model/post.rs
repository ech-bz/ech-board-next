use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use ech_board_entity::{entity, Dispatch, Entity, Record};
use ech_db_guest::Bind;
use ech_db_guest::BigMap;

use crate::context::{decode_arguments, encode, fail, Context};
use crate::error::ForumError;
use crate::model::{unique, Board, BoardKey, Esid, Forum, ForumKey, Hash, Sid, Thread, ThreadKey};

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct PostKey {
    pub number: u64,
    pub board: String,
}

#[entity(PostKey)]
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub enum Post {
    V1(PostV1),
}

#[derive(Bind, Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct PostV1 {
    pub thread: u64,
    pub text_hash: Option<Hash>,
    pub media_hashes: Vec<Hash>,
    pub name_hash: Option<Hash>,
    pub country: u32,
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
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PostPage {
    pub post: Entity<Post>,
    pub my_reactions: BTreeMap<Hash, Hash>,
}

impl PostV1 {
    pub(crate) fn my_reactions<'a>(
        context: &Context,
        posts: impl IntoIterator<Item = &'a Entity<Post>>,
    ) -> Result<BTreeMap<Hash, Hash>, Vec<u8>> {
        if context.is_server() {
            return Ok(BTreeMap::new());
        }
        let sid = context.author_sid()?;
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

    pub(crate) fn genesis(tx: &ech_db_protocol::value::Tx) -> Result<(Option<Esid>, u64), Vec<u8>> {
        let author = match &tx.user.author {
            ech_db_guest::Author::User { esid, .. } => Some(*esid),
            ech_db_guest::Author::Server => None,
        };
        let time = bcs::from_bytes::<crate::context::ServerContext>(&tx.server.ctx)
            .map_err(|_| fail(ForumError::NotAuthorized))?
            .time;
        Ok((author, time))
    }

    pub(crate) fn new(
        thread: u64,
        text_hash: Option<Hash>,
        media_hashes: Vec<Hash>,
        name_hash: Option<Hash>,
        multi_vote: bool,
        vote_keys: Vec<Hash>,
    ) -> PostV1 {
        PostV1 {
            thread,
            text_hash,
            media_hashes,
            name_hash,
            country: 0,
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
        }
    }

    fn set_media(
        context: &Context,
        post: &mut Entity<Post>,
        hashes: Vec<Hash>,
        ban: bool,
    ) -> Result<Vec<u8>, Vec<u8>> {
        let forum = Forum::load(&ForumKey {})?;
        let board = Board::load(&BoardKey {
            slug: post.key.board.clone(),
        })?;
        let thread = Thread::load(&ThreadKey {
            board: post.key.board.clone(),
            number: post.thread,
        })?;
        let moderator = thread.is_moderator(context, forum.inner(), board.inner());
        if !(moderator || (ban && thread.is_author(context, post)?)) {
            return Err(fail(ForumError::NotAuthorized));
        }
        if ban {
            for hash in &hashes {
                if !post.media_hashes.contains(hash) {
                    return Err(fail(ForumError::MediaNotFound));
                }
            }
        }
        for hash in hashes {
            if ban {
                if post.banned_media.contains(&hash) {
                    return Err(fail(ForumError::MediaAlreadyBanned));
                }
                post.banned_media.push(hash);
            } else {
                let index = post
                    .banned_media
                    .iter()
                    .position(|entry| *entry == hash)
                    .ok_or_else(|| fail(ForumError::MediaNotBanned))?;
                post.banned_media.remove(index);
            }
        }
        post.save()?;
        encode(&post)
    }
}

impl Dispatch<Context> for Post {
    fn dispatch(
        id: &[u8; 32],
        context: &Context,
        method: &str,
        args: &[u8],
    ) -> Result<Vec<u8>, Vec<u8>> {
        let mut post = Self::load_by_id(id)?;
        if !crate::context::read_only() && !context.is_server() {
            let sid = context.author_sid()?;
            let board = Board::load(&BoardKey {
                slug: post.key.board.clone(),
            })?;
            let thread = Thread::load(&ThreadKey {
                board: post.key.board.clone(),
                number: post.thread,
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
            "get" => encode(&PostPage {
                my_reactions: PostV1::my_reactions(context, [&post])?,
                post,
            }),
            "set_text" => {
                let (text_hash,): (Option<Hash>,) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                let board = Board::load(&BoardKey {
                    slug: post.key.board.clone(),
                })?;
                let thread = Thread::load(&ThreadKey {
                    board: post.key.board.clone(),
                    number: post.thread,
                })?;
                if !thread.is_moderator(context, forum.inner(), board.inner())
                    && !thread.is_author(context, &post)?
                {
                    return Err(fail(ForumError::NotAuthorized));
                }
                post.text_hash = text_hash;
                post.edited = true;
                post.save()?;
                encode(&post)
            }
            "set_deleted" => {
                let (deleted,): (bool,) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                let board = Board::load(&BoardKey {
                    slug: post.key.board.clone(),
                })?;
                let thread = Thread::load(&ThreadKey {
                    board: post.key.board.clone(),
                    number: post.thread,
                })?;
                let empty = post.text_hash.is_none() && post.media_hashes.is_empty();
                let authorized = thread.is_moderator(context, forum.inner(), board.inner())
                    || thread.is_author(context, &post)?
                    || (deleted && empty);
                if !authorized {
                    return Err(fail(ForumError::NotAuthorized));
                }
                post.deleted = deleted;
                post.save()?;
                encode(&post)
            }
            "vote" => {
                let (choices,): (Vec<Hash>,) = decode_arguments(args)?;
                let sid = context.author_sid()?;
                Thread::load(&ThreadKey {
                    board: post.key.board.clone(),
                    number: post.thread,
                })?;
                if post.deleted || post.votes.len() < 2 {
                    return Err(fail(ForumError::PollUnavailable));
                }
                if choices.is_empty() || (!post.multi_vote && choices.len() != 1) {
                    return Err(fail(ForumError::InvalidVoteCount));
                }
                if unique(&choices).is_none() {
                    return Err(fail(ForumError::DuplicatePollChoice));
                }
                if post.voted.get(&sid)?.is_some() {
                    return Err(fail(ForumError::AlreadyVoted));
                }
                for choice in &choices {
                    let entry = post
                        .votes
                        .iter_mut()
                        .find(|(hash, _)| hash == choice)
                        .ok_or_else(|| fail(ForumError::InvalidPollChoice))?;
                    entry.1 = entry
                        .1
                        .checked_add(1)
                        .ok_or_else(|| fail(ForumError::CounterOverflow))?;
                }
                post.voted.insert(&sid, &choices)?;
                post.save()?;
                encode(&post)
            }
            "react" => {
                let (old, reaction): (Option<Hash>, Hash) = decode_arguments(args)?;
                let sid = context.author_sid()?;
                let board = Board::load(&BoardKey {
                    slug: post.key.board.clone(),
                })?;
                Thread::load(&ThreadKey {
                    board: post.key.board.clone(),
                    number: post.thread,
                })?;
                if !board.reactions.contains(&reaction) {
                    return Err(fail(ForumError::ReactionNotAllowed));
                }
                if post.deleted {
                    return Err(fail(ForumError::PostDeleted));
                }
                let previous = post.reacted.get(&sid)?;
                if previous != old {
                    return Err(fail(ForumError::ReactionConflict));
                }
                if let Some(previous) = previous {
                    let entry = post
                        .reactions
                        .iter_mut()
                        .find(|(hash, _)| *hash == previous)
                        .ok_or_else(|| fail(ForumError::InvalidReactionCount))?;
                    entry.1 = entry
                        .1
                        .checked_sub(1)
                        .ok_or_else(|| fail(ForumError::InvalidReactionCount))?;
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
                            entry.1 = entry
                                .1
                                .checked_add(1)
                                .ok_or_else(|| fail(ForumError::CounterOverflow))?;
                        }
                        None => post.reactions.push((reaction, 1)),
                    }
                    post.reacted.insert(&sid, &reaction)?;
                }
                post.save()?;
                encode(&post)
            }
            "ban_media" => {
                let (hashes,): (Vec<Hash>,) = decode_arguments(args)?;
                PostV1::set_media(context, &mut post, hashes, true)
            }
            "unban_media" => {
                let (hashes,): (Vec<Hash>,) = decode_arguments(args)?;
                PostV1::set_media(context, &mut post, hashes, false)
            }
            "set_banned" => {
                let (banned,): (Option<Esid>,) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                let board = Board::load(&BoardKey {
                    slug: post.key.board.clone(),
                })?;
                let thread = Thread::load(&ThreadKey {
                    board: post.key.board.clone(),
                    number: post.thread,
                })?;
                if !thread.is_moderator(context, forum.inner(), board.inner()) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                post.banned = banned;
                post.save()?;
                encode(&post)
            }
            "set_mod_note" => {
                let (value,): (Option<Hash>,) = decode_arguments(args)?;
                let forum = Forum::load(&ForumKey {})?;
                let board = Board::load(&BoardKey {
                    slug: post.key.board.clone(),
                })?;
                let thread = Thread::load(&ThreadKey {
                    board: post.key.board.clone(),
                    number: post.thread,
                })?;
                if !thread.is_moderator(context, forum.inner(), board.inner()) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                post.mod_note_hash = value;
                post.save()?;
                encode(&post)
            }
            _ => Err(ech_board_entity::unknown_function("post", method)),
        }
    }
}
