use serde::{Deserialize, Serialize};

use ech_db_guest::{BigMap, Bind};

use crate::context::Context;
use crate::error::{ForumError, Result};
use crate::types::{Esid, Hash, Sid};

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug, Default)]
pub struct BanValue {
    pub reason_hash: Option<Hash>,
    pub expires: u64,
}

#[derive(Default, Bind, Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct Bans {
    pub public: BigMap<Esid, BanValue>,
    pub private: BigMap<Sid, Esid>,
}

impl Bans {
    pub fn ban(&self, esid: Esid, sid: Sid, value: BanValue) -> Result<()> {
        self.public.insert(&esid, &value)?;
        Ok(self.private.insert(&sid, &esid)?)
    }

    pub fn unban(&self, esid: &Esid, sid: &Sid) -> Result<()> {
        self.public.remove(esid)?;
        Ok(self.private.remove(sid)?)
    }

    pub fn banned(&self, sid: &Sid, now: u64) -> Result<bool> {
        let Some(esid) = self.private.get(sid)? else {
            return Ok(false);
        };
        let value = self.public.get(&esid)?;
        Ok(value.is_some_and(|value| value.expires == 0 || value.expires > now))
    }

    pub fn any_banned(bans: &[&Self], sid: &Sid, now: u64) -> Result<bool> {
        let private: Vec<_> = bans.iter().map(|bans| (&bans.private, sid)).collect();
        let authors = BigMap::get_batch(private.as_slice())?;
        Self::any_active(bans, &authors, now)
    }

    pub fn gate(bans: &[&Self]) -> Result<()> {
        if Context::read_only() || Context::is_server()? {
            return Ok(());
        }
        let sid = Context::author_sid()?;
        if Self::any_banned(bans, &sid, Context::time()?)? {
            return Err(ForumError::Banned);
        }
        Ok(())
    }

    pub fn any_active(bans: &[&Self], authors: &[Option<Esid>], now: u64) -> Result<bool> {
        let public: Vec<_> = bans
            .iter()
            .zip(authors)
            .filter_map(|(bans, author)| author.as_ref().map(|author| (&bans.public, author)))
            .collect();
        let values = BigMap::get_batch(public.as_slice())?;
        Ok(values
            .into_iter()
            .flatten()
            .any(|value| value.expires == 0 || value.expires > now))
    }

    pub fn entries(&self, after: Option<&Esid>, limit: usize) -> Result<Vec<(Esid, BanValue)>> {
        Ok(self.public.entries(after, limit)?)
    }
}
