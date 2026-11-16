use ech_board_entity::{entity, Entity, EntityError};
use ech_db_guest::Bind;
use serde::{Deserialize, Serialize};

use crate::context::Context;
use crate::error::{ForumError, Result};
use crate::types::Sid;

#[entity(Sid, private)]
#[derive(Bind, Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub enum User {
    V1(UserV1),
}

#[derive(Bind, Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct UserV1 {
    pub post_count: u64,
    pub thread_count: u64,
    pub last_post: u64,
    pub last_reaction: u64,
}

impl User {
    pub(crate) fn get() -> Result<Option<Entity<Self>>> {
        match Entity::<Self>::load(&Context::author_sid()?) {
            Ok(user) => Ok(Some(user)),
            Err(EntityError::NotFound) => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    pub(crate) fn record_post(rate_limit_ms: u32) -> Result<Entity<Self>> {
        Self::update(|user| {
            let now = Context::time();
            if now.saturating_sub(user.last_post) < rate_limit_ms as u64 {
                return Err(ForumError::RateLimited);
            }
            user.last_post = now;
            user.post_count = user
                .post_count
                .checked_add(1)
                .ok_or(ForumError::CounterOverflow)?;
            Ok(())
        })
    }

    pub(crate) fn record_reaction(rate_limit_ms: u32) -> Result<Entity<Self>> {
        Self::update(|user| {
            if user.post_count == 0 {
                return Err(ForumError::ReactionRequiresPost);
            }
            let now = Context::time();
            if now.saturating_sub(user.last_reaction) < rate_limit_ms as u64 {
                return Err(ForumError::RateLimited);
            }
            user.last_reaction = now;
            Ok(())
        })
    }

    pub(crate) fn record_thread() -> Result<Entity<Self>> {
        Self::update(|user| {
            user.thread_count = user
                .thread_count
                .checked_add(1)
                .ok_or(ForumError::CounterOverflow)?;
            Ok(())
        })
    }

    fn update(f: impl FnOnce(&mut Self) -> Result<()>) -> Result<Entity<Self>> {
        let sid = Context::author_sid()?;
        let existing = Self::get()?;
        let mut value = existing
            .as_ref()
            .map(|user| user.value.clone())
            .unwrap_or_else(|| {
                Self::from(UserV1 {
                    post_count: 0,
                    thread_count: 0,
                    last_post: 0,
                    last_reaction: 0,
                })
            });
        f(&mut value)?;
        match existing {
            Some(mut user) => {
                user.value = value;
                user.save()?;
                Ok(user)
            }
            None => Ok(Entity::<Self>::insert(sid, value)?),
        }
    }
}
