use serde::{Deserialize, Serialize};

use ech_board_entity::{entity, Dispatch, Entity, Record};
use ech_db_guest::{BigLog, Bind};

use crate::context::{decode_arguments, encode, fail, Context};
use crate::error::ForumError;

use crate::model::{BanValue, Bans, Board, BoardKey, BoardV1, Esid, Hash};

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct ForumKey {}

#[entity(ForumKey)]
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub enum Forum {
    V1(ForumV1),
}

#[derive(Bind, Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct ForumV1 {
    pub title_hash: Option<Hash>,
    pub moderators: Vec<Esid>,
    pub bans: Bans,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ForumPage {
    pub boards: Vec<Entity<Board>>,
}

impl Forum {
    pub(crate) fn create(context: &Context) -> Result<Vec<u8>, Vec<u8>> {
        if !context.is_server() {
            return Err(fail(ForumError::NotAuthorized));
        }
        if Self::load(&ForumKey {}).is_ok() {
            return Err(fail(ForumError::ForumExists));
        }
        let forum = Self::insert(
            ForumKey {},
            Forum::V1(ForumV1 {
                title_hash: None,
                moderators: Vec::new(),
                bans: Bans::new(),
            }),
        )?;
        encode(&(forum.key.clone(), forum.inner().clone()))
    }
}

impl ForumV1 {
    pub(crate) fn is_moderator(&self, context: &Context) -> bool {
        context.is_server() || self.moderators.iter().any(|esid| context.is_author(esid))
    }
}

impl Dispatch<Context> for Forum {
    fn dispatch(
        id: &[u8; 32],
        context: &Context,
        method: &str,
        args: &[u8],
    ) -> Result<Vec<u8>, Vec<u8>> {
        let mut forum = Self::load_by_id(id)?;
        if !crate::context::read_only()
            && !context.is_server()
            && forum.bans.banned(&context.author_sid()?, context.time)?
        {
            return Err(fail(ForumError::Banned));
        }
        match method {
            "meta" => encode(&forum),
            "page" => encode(&ForumPage {
                boards: BoardV1::listing()?,
            }),
            "create_board" => {
                let (slug, description_hash): (String, Option<Hash>) = decode_arguments(args)?;
                if !forum.is_moderator(context) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                if slug.is_empty()
                    || slug.len() > 32
                    || !slug.bytes().all(|byte| {
                        byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'
                    })
                {
                    return Err(fail(ForumError::InvalidBoardSlug));
                }
                if Board::load(&BoardKey { slug: slug.clone() }).is_ok() {
                    return Err(fail(ForumError::BoardExists));
                }
                let board = Board::insert(
                    BoardKey { slug: slug.clone() },
                    Board::V1(BoardV1 {
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
                        bumps: BigLog::new(),
                        bans: Bans::new(),
                    }),
                )?;
                encode(&board)
            }
            "set_title" => {
                let (title_hash,): (Hash,) = decode_arguments(args)?;
                if !forum.is_moderator(context) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                forum.title_hash = Some(title_hash);
                forum.save()?;
                encode(&(forum.key.clone(), forum.inner().clone()))
            }
            "add_moderator" => {
                let (member,): (Esid,) = decode_arguments(args)?;
                if !context.is_server() {
                    return Err(fail(ForumError::NotAuthorized));
                }
                if !forum.moderators.contains(&member) {
                    forum.moderators.push(member);
                }
                forum.save()?;
                encode(&(forum.key.clone(), forum.inner().clone()))
            }
            "remove_moderator" => {
                let (member,): (Esid,) = decode_arguments(args)?;
                if !context.is_server() {
                    return Err(fail(ForumError::NotAuthorized));
                }
                forum.moderators.retain(|entry| *entry != member);
                forum.save()?;
                encode(&(forum.key.clone(), forum.inner().clone()))
            }
            "ban" => {
                let (target, reason_hash, expires): (Esid, Option<Hash>, u64) =
                    decode_arguments(args)?;
                if !forum.is_moderator(context) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                if expires != 0 && expires <= context.time {
                    return Err(fail(ForumError::InvalidBanExpiry));
                }
                let sid = context.sid(&target)?;
                forum.bans.ban(
                    target,
                    sid,
                    BanValue {
                        reason_hash,
                        expires,
                    },
                )?;
                encode(&forum.bans.entries(None, 32)?)
            }
            "unban" => {
                let (target,): (Esid,) = decode_arguments(args)?;
                if !forum.is_moderator(context) {
                    return Err(fail(ForumError::NotAuthorized));
                }
                let sid = context.sid(&target)?;
                forum.bans.unban(&target, &sid)?;
                encode(&forum.bans.entries(None, 32)?)
            }
            "ban_list" => {
                let (after, limit): (Option<Esid>, u32) = decode_arguments(args)?;
                encode(&forum.bans.entries(after.as_ref(), limit as usize)?)
            }
            _ => Err(ech_board_entity::unknown_function("forum", method)),
        }
    }
}
