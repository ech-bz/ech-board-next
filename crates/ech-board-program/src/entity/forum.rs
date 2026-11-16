use serde::{Deserialize, Serialize};

use ech_board_entity::{entity, Entity};
use ech_db_guest::{BigLog, Bind};

use crate::component::bans::{Ban, Bans, Gate};
use crate::component::permissions::Permissions;
use crate::context::Context;
use crate::entity::{transactions, Board, BoardKey, Page, Read, Write};
use crate::error::{ForumError, Result};
use crate::types::{Esid, Hash};

#[derive(Bind, Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct ForumKey {}

#[entity(ForumKey)]
#[derive(Bind, Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
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
    pub(crate) fn permissions(&self) -> Permissions {
        if Context::is_server() {
            return Permissions::Root;
        }
        if Context::is_author_any(&self.moderators) {
            return Permissions::ForumMod;
        }
        Permissions::User
    }

    pub(crate) fn gate(forum: &Forum) -> Result<()> {
        forum.bans.gate()
    }

    pub(crate) fn create() -> Result<ForumKey> {
        if !Context::is_server() {
            return Err(ForumError::NotAuthorized);
        }
        if Entity::<Self>::load(&ForumKey {}).is_ok() {
            return Err(ForumError::ForumExists);
        }
        Entity::<Self>::insert(
            ForumKey {},
            Forum::from(ForumV1 {
                title_hash: None,
                moderators: Vec::new(),
                bans: Bans::default(),
                boards: BigLog::new(),
            }),
        )?;
        Ok(ForumKey {})
    }

    pub(crate) fn current() -> Result<Entity<Forum>> {
        Ok(Entity::<Self>::load(&ForumKey {})?)
    }

    pub(crate) fn meta(forum: &Read<Forum>) -> Result<Page<Entity<Forum>>> {
        let entity = (**forum).clone();
        let transactions = transactions(vec![entity.genesis])?;
        Ok(Page {
            view: entity,
            threads: Vec::new(),
            transactions,
        })
    }

    pub(crate) fn page(forum: &Read<Forum>) -> Result<Page<ForumPage>> {
        let entries = forum.boards.entries(None, u32::MAX as usize)?;
        let keys: Vec<BoardKey> = entries.into_iter().map(|(_, key)| key).collect();
        let boards: Vec<Entity<Board>> = Entity::<Board>::load_many(&keys)?
            .into_iter()
            .flatten()
            .collect();
        let transactions = transactions(boards.iter().map(|board| board.genesis).collect())?;
        Ok(Page {
            view: ForumPage { boards },
            threads: Vec::new(),
            transactions,
        })
    }

    pub(crate) fn set_title(forum: &mut Write<Forum>, title_hash: Hash) -> Result<()> {
        Self::gate(forum)?;
        if forum.permissions() < Permissions::ForumMod {
            return Err(ForumError::NotAuthorized);
        }
        forum.title_hash = Some(title_hash);
        forum.save()?;
        Ok(())
    }

    pub(crate) fn add_moderator(forum: &mut Write<Forum>, member: Esid) -> Result<()> {
        Self::gate(forum)?;
        if forum.permissions() < Permissions::Root {
            return Err(ForumError::NotAuthorized);
        }
        if !forum.moderators.contains(&member) {
            forum.moderators.push(member);
        }
        forum.save()?;
        Ok(())
    }

    pub(crate) fn remove_moderator(forum: &mut Write<Forum>, member: Esid) -> Result<()> {
        Self::gate(forum)?;
        if forum.permissions() < Permissions::Root {
            return Err(ForumError::NotAuthorized);
        }
        forum.moderators.retain(|entry| *entry != member);
        forum.save()?;
        Ok(())
    }

    pub(crate) fn ban(
        forum: &mut Write<Forum>,
        target: Esid,
        reason_hash: Option<Hash>,
        expires: Option<u64>,
    ) -> Result<()> {
        Self::gate(forum)?;
        if forum.permissions() < Permissions::ForumMod {
            return Err(ForumError::NotAuthorized);
        }
        let now = Context::time();
        if expires.is_some_and(|expires| expires <= now) {
            return Err(ForumError::InvalidBanExpiry);
        }
        let sid = Context::sid(&target)?;
        forum.bans.ban(
            sid,
            Ban {
                esid: target,
                reason_hash,
                expires,
            },
            now,
        )?;
        Ok(())
    }

    pub(crate) fn unban(forum: &mut Write<Forum>, target: Esid) -> Result<()> {
        Self::gate(forum)?;
        if forum.permissions() < Permissions::ForumMod {
            return Err(ForumError::NotAuthorized);
        }
        let sid = Context::sid(&target)?;
        forum.bans.unban(&sid, &target)?;
        Ok(())
    }

    pub(crate) fn ban_list(
        forum: &Read<Forum>,
        after: Option<Esid>,
        limit: u32,
    ) -> Result<Vec<Ban>> {
        let after = after.as_ref().map(Context::sid).transpose()?;
        forum.bans.entries(after.as_ref(), limit as usize)
    }
}
