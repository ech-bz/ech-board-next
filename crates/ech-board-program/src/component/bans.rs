use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use ech_board_entity::Entity;
use ech_db_guest::{load_transaction, Author, BigMap, Bind, Txid};

use crate::context::Context;
use crate::entity::{Board, Forum, Thread};
use crate::error::{ForumError, Result};
use crate::types::{Esid, Hash, Sid};

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct Ban {
    pub target: Txid,
    pub reason_hash: Option<Hash>,
    pub expires: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum BanScope {
    Thread,
    Board,
    Forum,
}

#[derive(Default, Bind, Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct Bans {
    records: BigMap<Sid, Vec<Ban>>,
    targets: BigMap<Txid, Sid>,
}

impl Bans {
    pub fn filter(
        forum: &Entity<Forum>,
        board: &Entity<Board>,
        thread: &Entity<Thread>,
        targets: &[Txid],
    ) -> Result<BTreeMap<BanScope, Vec<Txid>>> {
        let mut banned: BTreeMap<BanScope, Vec<Txid>> = BTreeMap::new();
        if targets.is_empty() {
            return Ok(banned);
        }
        for (bans, scope) in [
            (&forum.bans, BanScope::Forum),
            (&board.bans, BanScope::Board),
            (&thread.bans, BanScope::Thread),
        ] {
            let found: Vec<Txid> = bans
                .targets
                .get_many(targets)?
                .into_iter()
                .zip(targets)
                .filter_map(|(sid, target)| sid.map(|_| *target))
                .collect();
            if !found.is_empty() {
                banned.entry(scope).or_default().extend(found);
            }
        }
        Ok(banned)
    }

    pub fn ban(&self, ban: Ban, now: u64) -> Result<()> {
        let sid = Context::sid(&Self::target_author(ban.target)?)?;
        let mut records = self.read(&sid)?;
        if records
            .iter()
            .any(|entry| entry.expires.is_none_or(|expires| expires > now))
        {
            return Err(ForumError::AlreadyBanned);
        }
        self.targets.insert(&ban.target, &sid)?;
        records.push(ban);
        self.write(sid, records)
    }

    pub fn unban(&self, target: Txid) -> Result<()> {
        let sid = Context::sid(&Self::target_author(target)?)?;
        let mut records = self.read(&sid)?;
        let length = records.len();
        records.retain(|entry| entry.target != target);
        if records.len() == length {
            return Err(ForumError::NotBanned);
        }
        self.write(sid, records)?;
        self.targets.remove(&target)?;
        Ok(())
    }

    pub fn list(&self, after: Option<&Txid>, limit: usize) -> Result<Vec<Ban>> {
        let mut bans = Vec::new();
        for (target, sid) in self.targets.entries(after, limit)? {
            let records = self.read(&sid)?;
            if let Some(ban) = records.into_iter().rev().find(|ban| ban.target == target) {
                bans.push(ban);
            }
        }
        Ok(bans)
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

    fn target_author(target: Txid) -> Result<Esid> {
        match load_transaction(&target)?.user.author {
            Author::User { esid, .. } => Ok(esid),
            Author::Server => Err(ForumError::NotAuthorized),
        }
    }
}

pub trait BansGate {
    fn any_banned(&self, sid: &Sid, now: u64) -> Result<bool>;

    fn check_bans(&self) -> Result<()>;
}

impl BansGate for Bans {
    fn any_banned(&self, sid: &Sid, now: u64) -> Result<bool> {
        [self].any_banned(sid, now)
    }

    fn check_bans(&self) -> Result<()> {
        [self].check_bans()
    }
}

impl BansGate for [&Bans] {
    fn any_banned(&self, sid: &Sid, now: u64) -> Result<bool> {
        let requests: Vec<_> = self.iter().map(|bans| (&bans.records, sid)).collect();
        let lists = BigMap::get_batch(requests.as_slice())?;
        let mut banned = false;
        for records in lists {
            let Some(records) = records else {
                continue;
            };
            banned |= records
                .iter()
                .any(|entry| entry.expires.is_none_or(|expires| expires > now));
        }
        Ok(banned)
    }

    fn check_bans(&self) -> Result<()> {
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
