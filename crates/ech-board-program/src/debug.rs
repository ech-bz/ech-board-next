use ech_board_entity::{Entity, HistoryPage, Store, Stored};
use ech_db_guest::{load_transaction, Txid};

use crate::entity::{Board, Forum, ForumKey, Post, Thread};
use crate::error::{ForumError, Result};
use crate::types::Hash;

pub(crate) struct Debug;

impl Debug {
    pub(crate) fn entity(namespace: String, id: Hash) -> Result<Vec<u8>> {
        Store::record(&namespace, &id)?.ok_or(ForumError::NotFound)
    }

    pub(crate) fn history(
        namespace: String,
        id: Hash,
        before: Option<u64>,
        limit: u32,
    ) -> Result<HistoryPage> {
        if namespace == Forum::NAMESPACE {
            Self::history_of::<Forum>(&id, before, limit)
        } else if namespace == Board::NAMESPACE {
            Self::history_of::<Board>(&id, before, limit)
        } else if namespace == Thread::NAMESPACE {
            Self::history_of::<Thread>(&id, before, limit)
        } else if namespace == Post::NAMESPACE {
            Self::history_of::<Post>(&id, before, limit)
        } else {
            Err(ForumError::NotFound)
        }
    }

    fn history_of<T: Stored>(id: &Hash, before: Option<u64>, limit: u32) -> Result<HistoryPage> {
        let entity = Entity::<T>::load_by_id(id)?;
        let rows = entity.history.tail(before, limit as usize)?;
        let next = rows
            .last()
            .map(|(sequence, _)| *sequence)
            .filter(|sequence| *sequence > 0);
        let mut entries = Vec::with_capacity(rows.len());
        for (_, txid) in rows {
            entries.push(load_transaction(&Txid::new(txid))?);
        }
        Ok(HistoryPage {
            entries,
            next,
            length: entity.history.len(),
        })
    }

    pub(crate) fn forum() -> Result<[u8; 32]> {
        Ok(<Forum as Stored>::id(&ForumKey {}))
    }
}
