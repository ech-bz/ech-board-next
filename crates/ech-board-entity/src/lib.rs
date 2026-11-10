pub use ech_board_entity_macros::entity;
pub use ech_db_guest::Bind;

pub mod profile;

mod write_batch;

pub use write_batch::WriteBatch;

use std::ops::{Deref, DerefMut};

#[cfg(target_arch = "wasm32")]
use ech_db_guest::BigSet;
use ech_db_guest::{BigMap, Key};
use serde::de::DeserializeOwned;
use serde::Serialize;

pub type Result<T> = std::result::Result<T, Vec<u8>>;

pub fn entity_id<K: Serialize + ?Sized>(namespace: &str, key: &K) -> [u8; 32] {
    let bytes = bcs::to_bytes(&("ech/entity", namespace, key)).expect("entity id");
    ech_db_protocol::hash::Blake2b256::hash(&[bytes.as_slice()])
}

pub trait Record: Serialize + DeserializeOwned + Clone + Sized {
    type Key: Serialize + DeserializeOwned + Clone;

    const NAMESPACE: &'static str;
    const CURRENT: u32;

    fn version(&self) -> u32;

    fn attach(&mut self, id: &[u8; 32]);

    fn id(key: &Self::Key) -> [u8; 32] {
        entity_id(Self::NAMESPACE, key)
    }

    fn missing() -> Vec<u8>;

    fn load(key: &Self::Key) -> Result<Entity<Self>> {
        load::<Self>(&Self::id(key))?.ok_or_else(Self::missing)
    }

    fn load_by_id(id: &[u8; 32]) -> Result<Entity<Self>> {
        load::<Self>(id)?.ok_or_else(Self::missing)
    }

    fn load_many(keys: &[Self::Key]) -> Result<Vec<Option<Entity<Self>>>> {
        let ids: Vec<[u8; 32]> = profile::measure("entity_ids", || {
            keys.iter().map(|key| Self::id(key)).collect()
        });
        load_many::<Self>(&ids)
    }

    fn insert(key: Self::Key, value: Self) -> Result<Entity<Self>> {
        let id = Self::id(&key);
        insert::<Self>(key, value, &id)
    }
}

pub trait Dispatch<C>: Record {
    fn dispatch(id: &[u8; 32], context: &C, method: &str, args: &[u8]) -> Result<Vec<u8>>;
}

thread_local! {
    static ROOT: std::cell::Cell<Option<[u8; 32]>> = const { std::cell::Cell::new(None) };
}

pub fn begin_root(root: [u8; 32]) {
    ROOT.with(|slot| slot.set(Some(root)));
}

pub fn root() -> Result<[u8; 32]> {
    ROOT.with(|slot| slot.get())
        .ok_or_else(|| b"missing root context".to_vec())
}

#[derive(Clone, Debug, Serialize, serde::Deserialize)]
pub struct Write {
    pub txid: [u8; 32],
    pub tx: ech_db_protocol::value::Tx,
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

pub fn unsupported_version(stored: u32, current: u32) -> Vec<u8> {
    format!("entity version {stored} is newer than {current}").into_bytes()
}

thread_local! {
    static CURRENT: std::cell::RefCell<Option<Write>> = const { std::cell::RefCell::new(None) };
    static CHANGES: std::cell::RefCell<Vec<Changed>> = const { std::cell::RefCell::new(Vec::new()) };
}

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

#[derive(Serialize, serde::Deserialize)]
#[serde(bound = "")]
pub struct Entity<T: Record> {
    pub genesis: ech_db_protocol::value::Tx,
    pub key: T::Key,
    pub value: T,
    pub seq: u64,
}

impl<T: Record> Clone for Entity<T> {
    fn clone(&self) -> Self {
        Self {
            genesis: self.genesis.clone(),
            key: self.key.clone(),
            value: self.value.clone(),
            seq: self.seq,
        }
    }
}

impl<T: Record> Entity<T> {
    pub fn id(&self) -> [u8; 32] {
        T::id(&self.key)
    }

    pub fn needs_migration(&self) -> bool {
        self.value.version() != T::CURRENT
    }

    pub fn touches(&self) {
        touch::<T>(self.id());
    }
}

impl<T: Record> Deref for Entity<T> {
    type Target = T;

    fn deref(&self) -> &T {
        &self.value
    }
}

impl<T: Record> DerefMut for Entity<T> {
    fn deref_mut(&mut self) -> &mut T {
        &mut self.value
    }
}

#[cfg(target_arch = "wasm32")]
impl<T: Record> Entity<T> {
    pub fn migrate(&mut self) -> Result<()> {
        if !self.needs_migration() {
            return Ok(());
        }
        self.save()
    }

    pub fn save(&mut self) -> Result<()> {
        WriteBatch::new(&[self.id()])?.save(self)
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl<T: Record> Entity<T> {
    pub fn migrate(&mut self) -> Result<()> {
        if !self.needs_migration() {
            return Ok(());
        }
        self.save()
    }

    pub fn save(&mut self) -> Result<()> {
        unimplemented!("entity objects require the wasm runtime")
    }
}

#[cfg(target_arch = "wasm32")]
fn touch<T: Record>(id: [u8; 32]) {
    let Some(write) = current_write() else {
        return;
    };
    let sequence = next_sequence(&id);
    record_history(&id, sequence, &write.txid).expect("entity history");
}

#[cfg(target_arch = "wasm32")]
fn next_sequence(id: &[u8; 32]) -> u64 {
    let counts = history_counts();
    let count = counts.get(id).expect("entity history count").unwrap_or(0);
    let sequence = count.checked_add(1).expect("entity history overflow");
    counts.insert(id, &sequence).expect("entity history count");
    sequence
}

#[cfg(target_arch = "wasm32")]
fn record_history(id: &[u8; 32], sequence: u64, txid: &[u8; 32]) -> Result<()> {
    history(id).insert(&sequence, txid)
}

#[cfg(not(target_arch = "wasm32"))]
fn touch<T: Record>(_id: [u8; 32]) {}

#[cfg(target_arch = "wasm32")]
pub fn load<T: Record>(id: &[u8; 32]) -> Result<Option<Entity<T>>> {
    decode_entity(id, payloads().get(id)?.map(serde_bytes::ByteBuf::into_vec))
}

#[cfg(target_arch = "wasm32")]
fn decode_entity<T: Record>(id: &[u8; 32], raw: Option<Vec<u8>>) -> Result<Option<Entity<T>>> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let mut entity: Entity<T> = profile::measure("entity_decode", || bcs::from_bytes(&raw))
        .map_err(|error| format!("load entity: {error}").into_bytes())?;
    if entity.value.version() > T::CURRENT {
        return Err(unsupported_version(entity.value.version(), T::CURRENT));
    }
    if profile::measure("entity_check_id", || T::id(&entity.key)) != *id {
        return Err(b"entity key changed".to_vec());
    }
    profile::measure("entity_bind", || entity.value.attach(id));
    Ok(Some(entity))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn load<T: Record>(_id: &[u8; 32]) -> Result<Option<Entity<T>>> {
    unimplemented!("entity objects require the wasm runtime")
}

#[cfg(target_arch = "wasm32")]
pub fn load_many<T: Record>(ids: &[[u8; 32]]) -> Result<Vec<Option<Entity<T>>>> {
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
pub fn load_many<T: Record>(_ids: &[[u8; 32]]) -> Result<Vec<Option<Entity<T>>>> {
    unimplemented!("entity objects require the wasm runtime")
}

#[cfg(target_arch = "wasm32")]
pub fn load_pair<A: Record, B: Record>(
    a: &[u8; 32],
    b: &[u8; 32],
) -> Result<(Entity<A>, Entity<B>)> {
    let mut values = payloads().get_many(&[*a, *b])?.into_iter();
    let a = decode_entity::<A>(
        a,
        values.next().flatten().map(serde_bytes::ByteBuf::into_vec),
    )?
    .ok_or_else(A::missing)?;
    let b = decode_entity::<B>(
        b,
        values.next().flatten().map(serde_bytes::ByteBuf::into_vec),
    )?
    .ok_or_else(B::missing)?;
    Ok((a, b))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn load_pair<A: Record, B: Record>(
    _a: &[u8; 32],
    _b: &[u8; 32],
) -> Result<(Entity<A>, Entity<B>)> {
    unimplemented!("entity objects require the wasm runtime")
}

#[cfg(target_arch = "wasm32")]
pub fn load_with_entries<T: Record, K: Key, V: DeserializeOwned>(
    id: &[u8; 32],
    entries: &[(&BigMap<K, V>, &K)],
) -> Result<(Entity<T>, Vec<Option<V>>)> {
    let (raw, entries) = BigMap::get_batch(((&payloads(), id), entries))?;
    let entity =
        decode_entity::<T>(id, raw.map(serde_bytes::ByteBuf::into_vec))?.ok_or_else(T::missing)?;
    Ok((entity, entries))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn load_with_entries<T: Record, K: Key, V: DeserializeOwned>(
    _id: &[u8; 32],
    _entries: &[(&BigMap<K, V>, &K)],
) -> Result<(Entity<T>, Vec<Option<V>>)> {
    unimplemented!("entity objects require the wasm runtime")
}

#[cfg(target_arch = "wasm32")]
pub fn insert<T: Record>(key: T::Key, value: T, id: &[u8; 32]) -> Result<Entity<T>> {
    WriteBatch::new(&[*id])?.insert(key, value)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn insert<T: Record>(_key: T::Key, _value: T, _id: &[u8; 32]) -> Result<Entity<T>> {
    unimplemented!("entity objects require the wasm runtime")
}

#[cfg(target_arch = "wasm32")]
pub fn scan<T: Record>() -> Result<Vec<Entity<T>>> {
    let ids = types(T::NAMESPACE).entries(None, u32::MAX as usize)?;
    Ok(load_many::<T>(&ids)?.into_iter().flatten().collect())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn scan<T: Record>() -> Result<Vec<Entity<T>>> {
    unimplemented!("entity objects require the wasm runtime")
}

#[cfg(target_arch = "wasm32")]
pub fn load_history(id: &[u8; 32], before: Option<u64>, limit: u32) -> Result<Vec<HistoryEntry>> {
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

#[cfg(not(target_arch = "wasm32"))]
pub fn load_history(
    _id: &[u8; 32],
    _before: Option<u64>,
    _limit: u32,
) -> Result<Vec<HistoryEntry>> {
    unimplemented!("entity history requires the wasm runtime")
}

#[cfg(target_arch = "wasm32")]
pub fn load_record(namespace: &str, id: &[u8; 32]) -> Result<Option<Vec<u8>>> {
    if !types(namespace).contains(id)? {
        return Ok(None);
    }
    Ok(payloads().get(id)?.map(serde_bytes::ByteBuf::into_vec))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn load_record(_namespace: &str, _id: &[u8; 32]) -> Result<Option<Vec<u8>>> {
    unimplemented!("entity history requires the wasm runtime")
}

pub fn error(namespace: &str, reason: &str) -> Vec<u8> {
    format!("{namespace}: {reason}").into_bytes()
}

pub fn invalid_arguments() -> Vec<u8> {
    b"invalid arguments".to_vec()
}

pub fn unknown_function(namespace: &str, function: &str) -> Vec<u8> {
    format!("{namespace}: unknown function {function}").into_bytes()
}
