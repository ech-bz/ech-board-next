use serde::{Deserialize, Serialize};

use ech_board_entity::{entity, Entity};
use ech_db_guest::{BigLog, Bind};

use crate::component::bans::{BanValue, Bans};
use crate::context::Context;
use crate::entity::{Board, BoardKey, Read, Write};
use crate::error::{ForumError, Result};
use crate::types::{Esid, Hash};

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
    pub boards: BigLog<BoardKey>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ForumPage {
    pub boards: Vec<Entity<Board>>,
}

impl Forum {
    pub(crate) fn is_moderator(&self) -> Result<bool> {
        let value = match self {
            Self::V1(value) => value,
        };
        if Context::is_server()? {
            return Ok(true);
        }
        for esid in &value.moderators {
            if Context::is_author(esid)? {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub(crate) fn create() -> Result<Entity<Forum>> {
        if !Context::is_server()? {
            return Err(ForumError::NotAuthorized);
        }
        if Entity::<Self>::load(&ForumKey {}).is_ok() {
            return Err(ForumError::ForumExists);
        }
        let forum = Entity::<Self>::insert(
            ForumKey {},
            Forum::from(ForumV1 {
                title_hash: None,
                moderators: Vec::new(),
                bans: Bans::default(),
                boards: BigLog::new(),
            }),
        )?;
        Ok(forum)
    }

    pub(crate) fn current() -> Result<Entity<Forum>> {
        Ok(Entity::<Self>::load(&ForumKey {})?)
    }

    pub(crate) fn meta(forum: Read<Forum>) -> Result<Entity<Forum>> {
        Ok(forum.into_inner())
    }

    pub(crate) fn page(forum: Read<Forum>) -> Result<ForumPage> {
        let entries = forum.boards.entries(None, u32::MAX as usize)?;
        let keys: Vec<BoardKey> = entries.into_iter().map(|(_, key)| key).collect();
        Ok(ForumPage {
            boards: Entity::<Board>::load_many(&keys)?
                .into_iter()
                .flatten()
                .collect(),
        })
    }

    pub(crate) fn set_title(mut forum: Write<Forum>, title_hash: Hash) -> Result<Entity<Forum>> {
        Bans::gate(&[&forum.bans])?;
        if !forum.is_moderator()? {
            return Err(ForumError::NotAuthorized);
        }
        forum.title_hash = Some(title_hash);
        forum.save()?;
        Ok(forum.into_inner())
    }

    pub(crate) fn add_moderator(mut forum: Write<Forum>, member: Esid) -> Result<Entity<Forum>> {
        Bans::gate(&[&forum.bans])?;
        if !Context::is_server()? {
            return Err(ForumError::NotAuthorized);
        }
        if !forum.moderators.contains(&member) {
            forum.moderators.push(member);
        }
        forum.save()?;
        Ok(forum.into_inner())
    }

    pub(crate) fn remove_moderator(mut forum: Write<Forum>, member: Esid) -> Result<Entity<Forum>> {
        Bans::gate(&[&forum.bans])?;
        if !Context::is_server()? {
            return Err(ForumError::NotAuthorized);
        }
        forum.moderators.retain(|entry| *entry != member);
        forum.save()?;
        Ok(forum.into_inner())
    }

    pub(crate) fn ban(
        forum: Write<Forum>,
        target: Esid,
        reason_hash: Option<Hash>,
        expires: u64,
    ) -> Result<Vec<(Esid, BanValue)>> {
        Bans::gate(&[&forum.bans])?;
        if !forum.is_moderator()? {
            return Err(ForumError::NotAuthorized);
        }
        if expires != 0 && expires <= Context::time()? {
            return Err(ForumError::InvalidBanExpiry);
        }
        let sid = Context::sid(&target)?;
        forum.bans.ban(
            target,
            sid,
            BanValue {
                reason_hash,
                expires,
            },
        )?;
        forum.bans.entries(None, 32)
    }

    pub(crate) fn unban(forum: Write<Forum>, target: Esid) -> Result<Vec<(Esid, BanValue)>> {
        Bans::gate(&[&forum.bans])?;
        if !forum.is_moderator()? {
            return Err(ForumError::NotAuthorized);
        }
        let sid = Context::sid(&target)?;
        forum.bans.unban(&target, &sid)?;
        forum.bans.entries(None, 32)
    }

    pub(crate) fn ban_list(
        forum: Read<Forum>,
        after: Option<Esid>,
        limit: u32,
    ) -> Result<Vec<(Esid, BanValue)>> {
        forum.bans.entries(after.as_ref(), limit as usize)
    }
}
