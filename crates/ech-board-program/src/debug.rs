use ech_board_entity::{HistoryEntry, Store, Stored};

use crate::entity::{Forum, ForumKey};
use crate::error::{ForumError, Result};
use crate::types::Hash;

pub(crate) struct Debug;

impl Debug {
    pub(crate) fn entity(namespace: String, id: Hash) -> Result<Vec<u8>> {
        Store::record(&namespace, &id)?.ok_or(ForumError::NotFound)
    }

    pub(crate) fn history(id: Hash, before: Option<u64>, limit: u32) -> Result<Vec<HistoryEntry>> {
        Ok(Store::history(&id, before, limit)?)
    }

    pub(crate) fn forum() -> Result<[u8; 32]> {
        Ok(<Forum as Stored>::id(&ForumKey {}))
    }
}
