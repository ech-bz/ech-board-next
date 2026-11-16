use serde::{Deserialize, Serialize};

use ech_db_guest::{BigMap, Bind};

use crate::context::Context;
use crate::error::{ForumError, Result};
use crate::types::{Esid, Hash, Sid};

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct Ban {
    pub esid: Esid,
    pub reason_hash: Option<Hash>,
    pub expires: Option<u64>,
}

#[derive(Default, Bind, Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct Bans {
    records: BigMap<Sid, Vec<Ban>>,
}

impl Bans {
    pub fn ban(&self, sid: Sid, ban: Ban, now: u64) -> Result<()> {
        let mut records = self.read(&sid)?;
        records.retain(|entry| entry.expires.is_none_or(|expires| expires > now));
        if records.iter().any(|entry| entry.esid == ban.esid) {
            return Err(ForumError::AlreadyBanned);
        }
        records.push(ban);
        self.write(sid, records)
    }

    pub fn unban(&self, sid: &Sid, esid: &Esid) -> Result<()> {
        let mut records = self.read(sid)?;
        let index = records
            .iter()
            .position(|entry| &entry.esid == esid)
            .ok_or(ForumError::NotBanned)?;
        records.remove(index);
        self.write(*sid, records)
    }

    pub fn entries(&self, after: Option<&Sid>, limit: usize) -> Result<Vec<Ban>> {
        Ok(self
            .records
            .entries(after, limit)?
            .into_iter()
            .flat_map(|(_, records)| records)
            .collect())
    }

    fn read(&self, sid: &Sid) -> Result<Vec<Ban>> {
        match self.records.get(sid)? {
            Some(records) => Ok(records),
            None => Ok(Vec::new()),
        }
    }

    fn write(&self, sid: Sid, records: Vec<Ban>) -> Result<()> {
        if records.is_empty() {
            self.records.remove(&sid)?;
        } else {
            self.records.insert(&sid, &records)?;
        }
        Ok(())
    }
}

pub trait Gate {
    fn any_banned(&self, sid: &Sid, now: u64) -> Result<bool>;

    fn gate(&self) -> Result<()>;
}

impl Gate for Bans {
    fn any_banned(&self, sid: &Sid, now: u64) -> Result<bool> {
        [self].any_banned(sid, now)
    }

    fn gate(&self) -> Result<()> {
        [self].gate()
    }
}

impl Gate for [&Bans] {
    fn any_banned(&self, sid: &Sid, now: u64) -> Result<bool> {
        let requests: Vec<_> = self.iter().map(|bans| (&bans.records, sid)).collect();
        let lists = BigMap::get_batch(requests.as_slice())?;
        let mut banned = false;
        for (bans, records) in self.iter().zip(lists) {
            let Some(mut records) = records else {
                continue;
            };
            let length = records.len();
            records.retain(|entry| entry.expires.is_none_or(|expires| expires > now));
            let active = !records.is_empty();
            if records.len() != length {
                bans.write(*sid, records)?;
            }
            banned |= active;
        }
        Ok(banned)
    }

    fn gate(&self) -> Result<()> {
        if Context::read_only() || Context::is_server() {
            return Ok(());
        }
        let sid = Context::author_sid()?;
        if self.any_banned(&sid, Context::time())? {
            return Err(ForumError::Banned);
        }
        Ok(())
    }
}
