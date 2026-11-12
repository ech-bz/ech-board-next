pub use ech_board_entity_macros::entity;
pub use ech_db_guest::Bind;

pub mod call;
pub mod profile;

mod error;
mod functions;

pub use call::{Func, Prepare};
pub use error::EntityError;
pub use functions::Functions;

mod write_batch;

pub use write_batch::WriteBatch;

use std::ops::{Deref, DerefMut};

#[cfg(target_arch = "wasm32")]
use ech_db_guest::BigMap;
#[cfg(target_arch = "wasm32")]
use ech_db_guest::BigSet;
use ech_db_protocol::hash::Blake2b256;
use ech_db_protocol::value::Tx;
use serde::de::DeserializeOwned;
use serde::Serialize;

pub type Result<T> = std::result::Result<T, EntityError>;

fn entity_id<K: Serialize + ?Sized>(namespace: &str, key: &K) -> [u8; 32] {
    let bytes = bcs::to_bytes(&("ech/entity", namespace, key)).expect("entity id");
    Blake2b256::hash(&[bytes.as_slice()])
}

pub trait Upgrade<Next> {
    fn upgrade(&self) -> Result<Next>;
}

pub trait Stored: Serialize + DeserializeOwned + Clone + Sized {
    type Key: Serialize + DeserializeOwned + Clone;

    const NAMESPACE: &'static str;
    const CURRENT: u32;

    fn id(key: &Self::Key) -> [u8; 32] {
        entity_id(Self::NAMESPACE, key)
    }

    fn version(&self) -> u32;

    fn attach(&mut self, id: &[u8; 32]);

    fn migrate(&self) -> Result<Self>;
}

thread_local! {
    static CURRENT: std::cell::RefCell<Option<Write>> = const { std::cell::RefCell::new(None) };
    static CHANGES: std::cell::RefCell<Vec<Changed>> = const { std::cell::RefCell::new(Vec::new()) };
}

pub struct Session;

impl Session {
    pub fn begin_write(write: Write) {
        CURRENT.with(|current| *current.borrow_mut() = Some(write));
        CHANGES.with(|changes| changes.borrow_mut().clear());
    }

    pub fn current_write() -> Option<Write> {
        CURRENT.with(|current| current.borrow().clone())
    }

    pub fn take_changes() -> Vec<Changed> {
        CHANGES.with(|changes| std::mem::take(&mut *changes.borrow_mut()))
    }
}

#[derive(Clone, Debug, Serialize, serde::Deserialize)]
pub struct Write {
    pub txid: [u8; 32],
    pub tx: Tx,
}

#[derive(Clone, Debug, Serialize, serde::Deserialize)]
pub struct Changed {
    pub namespace: String,
    pub id: [u8; 32],
    #[serde(with = "serde_bytes")]
    pub value: Vec<u8>,
}

#[derive(Clone, Debug, Serialize, serde::Deserialize)]
pub struct Output {
    #[serde(with = "serde_bytes")]
    pub result: Vec<u8>,
    pub entities: Vec<Changed>,
}

#[derive(Clone, Copy, Debug, Serialize, serde::Deserialize)]
pub struct HistoryEntry {
    pub sequence: u64,
    pub txid: [u8; 32],
}

#[cfg(target_arch = "wasm32")]
fn payloads() -> BigMap<[u8; 32], serde_bytes::ByteBuf> {
    BigMap::open("entities/payloads")
}

#[cfg(target_arch = "wasm32")]
fn types(namespace: &str) -> BigSet<[u8; 32]> {
    BigSet::open(&("entities/types", namespace))
}

#[cfg(target_arch = "wasm32")]
fn history_counts() -> BigMap<[u8; 32], u64> {
    BigMap::open("entities/history/counts")
}

#[cfg(target_arch = "wasm32")]
fn history(id: &[u8; 32]) -> BigMap<u64, [u8; 32]> {
    BigMap::open(&("entities/history/entries", id))
}

#[cfg(target_arch = "wasm32")]
fn change(namespace: &str, id: [u8; 32], value: Vec<u8>) {
    CHANGES.with(|changes| {
        let mut changes = changes.borrow_mut();
        if let Some(entry) = changes.iter_mut().find(|entry| entry.id == id) {
            entry.value = value;
            return;
        }
        changes.push(Changed {
            namespace: namespace.to_string(),
            id,
            value,
        });
    });
}

#[derive(Clone, Serialize, serde::Deserialize)]
#[serde(bound = "")]
pub struct Entity<T: Stored> {
    pub genesis: Tx,
    pub key: T::Key,
    pub value: T,
    pub seq: u64,
}

impl<T: Stored> Entity<T> {
    pub fn id(&self) -> [u8; 32] {
        T::id(&self.key)
    }

    pub fn load(key: &T::Key) -> Result<Self> {
        Self::load_by_id(&T::id(key))
    }

    pub fn load_by_id(id: &[u8; 32]) -> Result<Self> {
        load::<T>(id)?.ok_or_else(not_found)
    }

    pub fn load_many(keys: &[T::Key]) -> Result<Vec<Option<Self>>> {
        let ids: Vec<[u8; 32]> =
            profile::measure("entity_ids", || keys.iter().map(|key| T::id(key)).collect());
        load_many::<T>(&ids)
    }

    pub fn insert(key: T::Key, value: T) -> Result<Self> {
        let id = T::id(&key);
        insert::<T>(key, value, &id)
    }

    pub fn needs_migration(&self) -> bool {
        self.value.version() != T::CURRENT
    }

    pub fn migrate(&mut self) -> Result<()> {
        if !self.needs_migration() {
            return Ok(());
        }
        self.save()
    }
}

impl<T: Stored> Deref for Entity<T> {
    type Target = T;

    fn deref(&self) -> &T {
        &self.value
    }
}

impl<T: Stored> DerefMut for Entity<T> {
    fn deref_mut(&mut self) -> &mut T {
        &mut self.value
    }
}

#[cfg(target_arch = "wasm32")]
impl<T: Stored> Entity<T> {
    pub fn save(&mut self) -> Result<()> {
        if self.needs_migration() {
            self.value = self.value.migrate()?;
            let id = T::id(&self.key);
            self.value.attach(&id);
        }
        WriteBatch::new(&[self.id()])?.save(self)
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl<T: Stored> Entity<T> {
    pub fn save(&mut self) -> Result<()> {
        unimplemented!("entity objects require the wasm runtime")
    }
}

#[cfg(target_arch = "wasm32")]
fn record_history(id: &[u8; 32], sequence: u64, txid: &[u8; 32]) -> Result<()> {
    Ok(history(id).insert(&sequence, txid)?)
}

#[cfg(target_arch = "wasm32")]
fn load<T: Stored>(id: &[u8; 32]) -> Result<Option<Entity<T>>> {
    decode_entity(id, payloads().get(id)?.map(serde_bytes::ByteBuf::into_vec))
}

#[cfg(target_arch = "wasm32")]
fn decode_entity<T: Stored>(id: &[u8; 32], raw: Option<Vec<u8>>) -> Result<Option<Entity<T>>> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let mut entity: Entity<T> = profile::measure("entity_decode", || bcs::from_bytes(&raw))
        .map_err(|error| EntityError::Decode(error.to_string()))?;
    if entity.value.version() > T::CURRENT {
        return Err(EntityError::UnsupportedVersion {
            stored: entity.value.version(),
            current: T::CURRENT,
        });
    }
    if profile::measure("entity_check_id", || T::id(&entity.key)) != *id {
        return Err(EntityError::KeyChanged);
    }
    profile::measure("entity_bind", || entity.value.attach(id));
    Ok(Some(entity))
}

#[cfg(not(target_arch = "wasm32"))]
fn load<T: Stored>(_id: &[u8; 32]) -> Result<Option<Entity<T>>> {
    unimplemented!("entity objects require the wasm runtime")
}

#[cfg(target_arch = "wasm32")]
fn load_many<T: Stored>(ids: &[[u8; 32]]) -> Result<Vec<Option<Entity<T>>>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let values = payloads().get_many(ids)?;
    ids.iter()
        .zip(values)
        .map(|(id, raw)| decode_entity(id, raw.map(serde_bytes::ByteBuf::into_vec)))
        .collect()
}

#[cfg(not(target_arch = "wasm32"))]
fn load_many<T: Stored>(_ids: &[[u8; 32]]) -> Result<Vec<Option<Entity<T>>>> {
    unimplemented!("entity objects require the wasm runtime")
}

#[cfg(target_arch = "wasm32")]
fn insert<T: Stored>(key: T::Key, value: T, id: &[u8; 32]) -> Result<Entity<T>> {
    WriteBatch::new(&[*id])?.insert(key, value)
}

#[cfg(not(target_arch = "wasm32"))]
fn insert<T: Stored>(_key: T::Key, _value: T, _id: &[u8; 32]) -> Result<Entity<T>> {
    unimplemented!("entity objects require the wasm runtime")
}

pub struct Store;

#[cfg(target_arch = "wasm32")]
impl Store {
    pub fn history(id: &[u8; 32], before: Option<u64>, limit: u32) -> Result<Vec<HistoryEntry>> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        let count = history_counts().get(id)?.unwrap_or(0);
        let end = before
            .map(|before| before.saturating_sub(1).min(count))
            .unwrap_or(count);
        let start = end.saturating_sub(limit as u64);
        let sequences: Vec<_> = (start + 1..=end).rev().collect();
        let values = history(id).get_many(&sequences)?;
        Ok(sequences
            .into_iter()
            .zip(values)
            .filter_map(|(sequence, txid)| txid.map(|txid| HistoryEntry { sequence, txid }))
            .collect())
    }

    pub fn record(namespace: &str, id: &[u8; 32]) -> Result<Option<Vec<u8>>> {
        if !types(namespace).contains(id)? {
            return Ok(None);
        }
        Ok(payloads().get(id)?.map(serde_bytes::ByteBuf::into_vec))
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl Store {
    pub fn history(_id: &[u8; 32], _before: Option<u64>, _limit: u32) -> Result<Vec<HistoryEntry>> {
        unimplemented!("entity history requires the wasm runtime")
    }

    pub fn record(_namespace: &str, _id: &[u8; 32]) -> Result<Option<Vec<u8>>> {
        unimplemented!("entity objects require the wasm runtime")
    }
}

fn not_found() -> EntityError {
    EntityError::NotFound
}
