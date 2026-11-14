use std::collections::{BTreeMap, BTreeSet};

use ech_board_entity::{Entity, HistoryPage, Store, Stored};
use ech_db_guest::{load_transaction, load_transactions, Tx, Txid};

use crate::entity::{Board, Forum, ForumKey, Post, Thread, ThreadKey};
use crate::error::{ForumError, Result};
use crate::types::Hash;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Changes {
    pub entities: Vec<Vec<u8>>,
    pub threads: Vec<(Hash, Vec<u8>)>,
    pub txids: Vec<Hash>,
    pub transactions: Vec<Tx>,
}

pub(crate) struct Debug;

impl Debug {
    pub(crate) fn changes(changes: Vec<(String, Hash)>) -> Result<Changes> {
        let mut entities = Vec::with_capacity(changes.len());
        let mut threads: BTreeMap<Hash, Vec<u8>> = BTreeMap::new();
        let mut txids: BTreeSet<Hash> = BTreeSet::new();
        for (namespace, id) in changes {
            let value = Store::record(&namespace, &id)?.ok_or(ForumError::NotFound)?;
            match namespace.as_str() {
                Post::NAMESPACE => {
                    let entity: Entity<Post> = bcs::from_bytes(&value).expect("post decodes");
                    txids.insert(*entity.genesis.as_array());
                    if !entity.deleted {
                        let thread = Thread::id(&ThreadKey {
                            board: entity.key.board.clone(),
                            number: entity.thread,
                        });
                        if !threads.contains_key(&thread) {
                            let thread_value = Store::record(Thread::NAMESPACE, &thread)?
                                .ok_or(ForumError::NotFound)?;
                            threads.insert(thread, thread_value);
                        }
                    }
                }
                Thread::NAMESPACE => {
                    let entity: Entity<Thread> = bcs::from_bytes(&value).expect("thread decodes");
                    txids.insert(*entity.genesis.as_array());
                }
                Board::NAMESPACE => {
                    let entity: Entity<Board> = bcs::from_bytes(&value).expect("board decodes");
                    txids.insert(*entity.genesis.as_array());
                }
                Forum::NAMESPACE => {
                    let entity: Entity<Forum> = bcs::from_bytes(&value).expect("forum decodes");
                    txids.insert(*entity.genesis.as_array());
                }
                _ => return Err(ForumError::NotFound),
            }
            entities.push(value);
        }
        let txids: Vec<Hash> = txids.into_iter().collect();
        let list: Vec<Txid> = txids.iter().map(|id| Txid::new(*id)).collect();
        let transactions = load_transactions(&list)?;
        Ok(Changes {
            entities,
            threads: threads.into_iter().collect(),
            txids,
            transactions,
        })
    }

    pub(crate) fn entity(namespace: String, id: Hash) -> Result<Vec<u8>> {
        Store::record(&namespace, &id)?.ok_or(ForumError::NotFound)
    }

    pub(crate) fn entities(changes: Vec<(String, Hash)>) -> Result<Vec<u8>> {
        let mut values = Vec::with_capacity(changes.len());
        for (namespace, id) in changes {
            values.push(Store::record(&namespace, &id)?.ok_or(ForumError::NotFound)?);
        }
        Ok(bcs::to_bytes(&values).expect("entities encode"))
    }

    pub(crate) fn transactions(txids: Vec<Hash>) -> Result<Vec<Tx>> {
        let txids: Vec<Txid> = txids.into_iter().map(Txid::new).collect();
        Ok(load_transactions(&txids)?)
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
