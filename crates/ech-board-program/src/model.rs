pub mod board;
pub mod forum;
pub mod post;
pub mod thread;

pub use board::{Board, BoardKey, BoardPage, BoardV1};
pub use forum::{Forum, ForumKey, ForumPage, ForumV1};
pub use post::{Post, PostKey, PostV1};
pub use thread::{Thread, ThreadKey, ThreadMeta, ThreadPage, ThreadPreview, ThreadV1};

use serde::{Deserialize, Serialize};

pub use ech_db_guest::Esid;

pub type Hash = [u8; 32];
pub type Sid = [u8; 32];

pub const EDIT_WINDOW_MS: u64 = 600_000;

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug, Default)]
pub struct BanValue {
    pub reason_hash: Option<Hash>,
    pub expires: u64,
}

#[derive(ech_board_entity::Bind, Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct Bans {
    pub public: ech_board_entity::Table<Esid, BanValue>,
    pub private: ech_board_entity::Table<Sid, Esid>,
}

impl Default for Bans {
    fn default() -> Self {
        Self {
            public: ech_board_entity::Table::new(),
            private: ech_board_entity::Table::new(),
        }
    }
}

impl Bans {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn ban(&self, esid: Esid, sid: Sid, value: BanValue) -> Result<(), Vec<u8>> {
        self.public.insert(&esid, &value)?;
        self.private.insert(&sid, &esid)
    }

    pub fn unban(&self, esid: &Esid, sid: &Sid) -> Result<(), Vec<u8>> {
        self.public.remove(esid)?;
        self.private.remove(sid)
    }

    pub fn banned(&self, sid: &Sid, now: u64) -> Result<bool, Vec<u8>> {
        let Some(esid) = self.private.get(sid)? else {
            return Ok(false);
        };
        let value = self.public.get(&esid)?;
        Ok(value.is_some_and(|value| value.expires == 0 || value.expires > now))
    }

    pub fn any_banned(bans: &[&Self], sid: &Sid, now: u64) -> Result<bool, Vec<u8>> {
        let private: Vec<_> = bans.iter().map(|bans| (&bans.private, sid)).collect();
        let authors = ech_board_entity::Table::get_batch(&private)?;
        Self::any_active(bans, &authors, now)
    }

    pub fn any_active(bans: &[&Self], authors: &[Option<Esid>], now: u64) -> Result<bool, Vec<u8>> {
        let public: Vec<_> = bans
            .iter()
            .zip(authors)
            .filter_map(|(bans, author)| author.as_ref().map(|author| (&bans.public, author)))
            .collect();
        let values = ech_board_entity::Table::get_batch(&public)?;
        Ok(values
            .into_iter()
            .flatten()
            .any(|value| value.expires == 0 || value.expires > now))
    }

    pub fn entries(
        &self,
        after: Option<&Esid>,
        limit: usize,
    ) -> Result<Vec<(Esid, BanValue)>, Vec<u8>> {
        self.public.entries(after, limit)
    }
}

pub fn unique(hashes: &[Hash]) -> Option<()> {
    let mut sorted = hashes.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    (sorted.len() == hashes.len()).then_some(())
}
