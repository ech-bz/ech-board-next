pub mod board;
pub mod forum;
pub mod post;
pub mod thread;
pub mod user;

use serde::{Deserialize, Serialize};

use ech_db_guest::{load_transactions, Tx, Txid};

use crate::error::Result;
use crate::types::Hash;

#[derive(Serialize, Deserialize, Clone)]
pub struct Page<T> {
    pub view: T,
    pub threads: Vec<(Hash, Vec<u8>)>,
    pub transactions: Vec<(Hash, Tx)>,
}

pub(crate) fn transactions(txids: Vec<Txid>) -> Result<Vec<(Hash, Tx)>> {
    let transactions = load_transactions(&txids)?;
    Ok(txids
        .iter()
        .zip(transactions)
        .map(|(txid, tx)| (*txid.as_array(), tx))
        .collect())
}

pub use board::{Board, BoardCursor, BoardKey, BoardPage, BoardV1};
pub use forum::{Forum, ForumKey, ForumPage, ForumV1};
pub use post::{Post, PostKey, PostPage, PostV1};
pub use thread::{Thread, ThreadKey, ThreadMeta, ThreadPage, ThreadPreview, ThreadV1};
pub use user::User;

pub use ech_board_entity::call::{Read, Write};
