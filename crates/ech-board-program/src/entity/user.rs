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
}

impl User {
    pub(crate) fn record_post() -> Result<Entity<Self>> {
        Self::update(|user| {
            user.post_count = user
                .post_count
                .checked_add(1)
                .ok_or(ForumError::CounterOverflow)?;
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
        let existing = match Entity::<Self>::load(&sid) {
            Ok(user) => Some(user),
            Err(EntityError::NotFound) => None,
            Err(error) => return Err(error.into()),
        };
        let mut value = existing
            .as_ref()
            .map(|user| user.value.clone())
            .unwrap_or_else(|| {
                Self::from(UserV1 {
                    post_count: 0,
                    thread_count: 0,
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
