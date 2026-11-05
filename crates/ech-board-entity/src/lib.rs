pub use ech_board_entity_macros::{entity, Bind};

use std::fmt;
use std::marker::PhantomData;
use std::ops::{Deref, DerefMut};

use serde::de::DeserializeOwned;
use serde::Serialize;

pub type Result<T> = std::result::Result<T, Vec<u8>>;

pub fn entity_id<K: Serialize + ?Sized>(namespace: &str, key: &K) -> [u8; 32] {
    let bytes = bcs::to_bytes(&("ech/entity", namespace, key)).expect("entity id");
    ech_db_protocol::hash::Blake2b256::hash(&[bytes.as_slice()])
}

pub fn field_id(field: &str) -> [u8; 32] {
    let bytes = bcs::to_bytes(&("ech/table", field)).expect("table id");
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
        let ids: Vec<[u8; 32]> = keys.iter().map(|key| Self::id(key)).collect();
        load_many::<Self>(&ids)
    }

    fn insert(key: Self::Key, value: Self) -> Result<Entity<Self>> {
        let id = Self::id(&key);
        insert::<Self>(key, value, &id)
    }
}

pub trait Dispatch<C>: Record {
    fn dispatch(entity: Entity<Self>, context: &C, method: &str, args: &[u8]) -> Result<Vec<u8>>;
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
    pub value: Vec<u8>,
}

#[derive(Clone, Debug, Serialize, serde::Deserialize)]
pub struct Output {
    pub result: Vec<u8>,
    pub entities: Vec<Changed>,
}

#[derive(Clone, Copy, Debug, Serialize, serde::Deserialize)]
pub struct HistoryEntry {
    pub sequence: u64,
    pub txid: [u8; 32],
}

pub fn entity_prefix(id: &[u8; 32]) -> Vec<u8> {
    let mut key = b"entity/".to_vec();
    key.extend_from_slice(id);
    key.push(b'/');
    key
}

pub fn payload_key(id: &[u8; 32]) -> Vec<u8> {
    let mut key = entity_prefix(id);
    key.extend_from_slice(b"payload");
    key
}

pub fn table_prefix(owner: &[u8; 32], field: &str) -> Vec<u8> {
    let mut key = entity_prefix(owner);
    key.extend_from_slice(b"kv/");
    key.extend_from_slice(&field_id(field));
    key.push(b'/');
    key
}

pub fn type_prefix(namespace: &str) -> Vec<u8> {
    let mut key = b"types/".to_vec();
    key.extend_from_slice(namespace.as_bytes());
    key.push(b'/');
    key
}

pub fn type_key(namespace: &str, id: &[u8; 32]) -> Vec<u8> {
    let mut key = type_prefix(namespace);
    key.extend_from_slice(id);
    key
}

pub fn history_count_key(id: &[u8; 32]) -> Vec<u8> {
    let mut key = b"history/".to_vec();
    key.extend_from_slice(id);
    key.extend_from_slice(b"/seq");
    key
}

pub fn history_data_key(id: &[u8; 32], sequence: u64) -> Vec<u8> {
    let mut key = b"history/".to_vec();
    key.extend_from_slice(id);
    key.extend_from_slice(b"/data/");
    key.extend_from_slice(&sequence.to_be_bytes());
    key
}

pub fn unsupported_version(stored: u32, current: u32) -> Vec<u8> {
    format!("entity version {stored} is newer than {current}").into_bytes()
}

pub struct Transaction;

impl Transaction {
    pub fn tx(txid: &[u8; 32]) -> Result<ech_db_protocol::value::Tx> {
        let root = ech_db_protocol::id::Root::new(root()?)
            .map_err(|_| b"missing root context".to_vec())?;
        let base = ech_db_protocol::keys::Keys::tx(&root).len();
        let txid = ech_db_protocol::id::Txid::new(*txid);
        let len = ech_db_protocol::keys::Keys::body_len(&root, &txid);
        let count = Self::typed::<u64>(ech_db_protocol::keys::ReadKey::tx(len[base..].to_vec()))?
            .ok_or_else(|| b"missing transaction body".to_vec())?;
        let mut body = Vec::new();
        for sequence in 0..count {
            let key = ech_db_protocol::keys::Keys::body(&root, &txid, sequence);
            body.extend_from_slice(
                &Self::raw(ech_db_protocol::keys::ReadKey::tx(key[base..].to_vec()))?
                    .ok_or_else(|| b"missing transaction chunk".to_vec())?,
            );
        }
        bcs::from_bytes(&body).map_err(|error| format!("transaction body: {error}").into_bytes())
    }

    #[cfg(target_arch = "wasm32")]
    fn raw(key: ech_db_protocol::keys::ReadKey) -> Result<Option<Vec<u8>>> {
        Ok(ech_db_guest::Host::get_raw(&[key]).pop().flatten())
    }

    #[cfg(target_arch = "wasm32")]
    fn typed<T: serde::de::DeserializeOwned>(
        key: ech_db_protocol::keys::ReadKey,
    ) -> Result<Option<T>> {
        Ok(ech_db_guest::Host::get_raw(&[key])
            .pop()
            .flatten()
            .map(|bytes| {
                bcs::from_bytes(&bytes)
                    .map_err(|error| format!("transaction value: {error}").into_bytes())
            })
            .transpose()?)
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn raw(_key: ech_db_protocol::keys::ReadKey) -> Result<Option<Vec<u8>>> {
        unimplemented!("entity transactions require the wasm runtime")
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn typed<T: serde::de::DeserializeOwned>(
        _key: ech_db_protocol::keys::ReadKey,
    ) -> Result<Option<T>> {
        unimplemented!("entity transactions require the wasm runtime")
    }
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

pub trait Key: Sized {
    fn encode(&self) -> Vec<u8>;

    fn decode(bytes: &[u8]) -> Option<Self>;
}

impl Key for u64 {
    fn encode(&self) -> Vec<u8> {
        self.to_be_bytes().to_vec()
    }

    fn decode(bytes: &[u8]) -> Option<Self> {
        Some(u64::from_be_bytes(bytes.try_into().ok()?))
    }
}

impl Key for [u8; 32] {
    fn encode(&self) -> Vec<u8> {
        self.to_vec()
    }

    fn decode(bytes: &[u8]) -> Option<Self> {
        bytes.try_into().ok()
    }
}

impl Key for String {
    fn encode(&self) -> Vec<u8> {
        self.as_bytes().to_vec()
    }

    fn decode(bytes: &[u8]) -> Option<Self> {
        String::from_utf8(bytes.to_vec()).ok()
    }
}

impl Key for ech_db_protocol::value::Esid {
    fn encode(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(96);
        bytes.extend_from_slice(&self.tweak);
        bytes.extend_from_slice(&self.c1);
        bytes.extend_from_slice(&self.c2);
        bytes
    }

    fn decode(bytes: &[u8]) -> Option<Self> {
        let bytes: [u8; 96] = bytes.try_into().ok()?;
        Some(ech_db_protocol::value::Esid {
            tweak: bytes[0..32].try_into().ok()?,
            c1: bytes[32..64].try_into().ok()?,
            c2: bytes[64..96].try_into().ok()?,
        })
    }
}

#[derive(Serialize, serde::Deserialize)]
pub struct Table<K, V> {
    #[serde(skip)]
    prefix: Option<Vec<u8>>,
    #[serde(skip)]
    marker: PhantomData<fn(K) -> V>,
}

impl<K, V> Table<K, V> {
    pub fn new() -> Self {
        Self {
            prefix: None,
            marker: PhantomData,
        }
    }

    pub fn bind(&mut self, owner: &[u8; 32], field: &str) {
        self.prefix = Some(table_prefix(owner, field));
    }

    fn prefix(&self) -> Result<&[u8]> {
        self.prefix
            .as_deref()
            .ok_or_else(|| b"unbound table".to_vec())
    }
}

impl<K, V> Default for Table<K, V> {
    fn default() -> Self {
        Self::new()
    }
}

impl<K, V> Clone for Table<K, V> {
    fn clone(&self) -> Self {
        Self {
            prefix: self.prefix.clone(),
            marker: PhantomData,
        }
    }
}

impl<K, V> PartialEq for Table<K, V> {
    fn eq(&self, other: &Self) -> bool {
        self.prefix == other.prefix
    }
}

impl<K, V> Eq for Table<K, V> {}

impl<K, V> fmt::Debug for Table<K, V> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Table")
    }
}

impl<K: Key, V> Table<K, V> {
    pub fn key(&self, key: &K) -> Result<Vec<u8>> {
        let mut bytes = self.prefix()?.to_vec();
        bytes.extend_from_slice(&key.encode());
        Ok(bytes)
    }
}

#[cfg(target_arch = "wasm32")]
impl<K: Key + Clone, V: Serialize + DeserializeOwned> Table<K, V> {
    pub fn get(&self, key: &K) -> Result<Option<V>> {
        Ok(
            ech_db_guest::Host::get::<V>(&[ech_db_guest::ReadKey::kv(self.key(key)?)])
                .pop()
                .flatten(),
        )
    }

    pub fn get_many(&self, keys: &[K]) -> Result<Vec<Option<V>>> {
        let mut reads = Vec::with_capacity(keys.len());
        for key in keys {
            reads.push(ech_db_guest::ReadKey::kv(self.key(key)?));
        }
        Ok(ech_db_guest::Host::get::<V>(&reads))
    }

    pub fn get_batch(entries: &[(&Self, &K)]) -> Result<Vec<Option<V>>> {
        if entries.is_empty() {
            return Ok(Vec::new());
        }
        let mut reads = Vec::with_capacity(entries.len());
        for (table, key) in entries {
            reads.push(ech_db_guest::ReadKey::kv(table.key(key)?));
        }
        Ok(ech_db_guest::Host::get::<V>(&reads))
    }

    pub fn insert(&self, key: &K, value: &V) -> Result<()> {
        ech_db_guest::Host::put_value(&self.key(key)?, value);
        Ok(())
    }

    pub fn remove(&self, key: &K) -> Result<()> {
        ech_db_guest::Host::del(&self.key(key)?);
        Ok(())
    }

    pub fn entries(&self, after: Option<&K>, limit: usize) -> Result<Vec<(K, V)>> {
        let prefix = self.prefix()?.to_vec();
        let start = match after {
            Some(after) => self.key(after)?,
            None => prefix.clone(),
        };
        let end = ech_db_guest::Prefix::successor(&prefix).unwrap_or_default();
        let mut rows =
            ech_db_guest::Host::range_raw(&ech_db_guest::Range::kv(start.clone(), Some(end)));
        rows.retain(|(key, _)| key.as_slice() > start.as_slice());
        let mut out = Vec::new();
        for (key, value) in rows {
            if key.len() <= prefix.len() {
                continue;
            }
            let Some(key) = K::decode(&key[prefix.len()..]) else {
                continue;
            };
            out.push((
                key,
                bcs::from_bytes(&value)
                    .map_err(|error| format!("table row: {error}").into_bytes())?,
            ));
            if out.len() == limit {
                break;
            }
        }
        Ok(out)
    }

    pub fn range(&self, from: Option<&K>, to: Option<&K>, limit: usize) -> Result<Vec<(K, V)>> {
        let prefix = self.prefix()?.to_vec();
        let start = match from {
            Some(from) => self.key(from)?,
            None => prefix.clone(),
        };
        let end = match to {
            Some(to) => self.key(to)?,
            None => ech_db_guest::Prefix::successor(&prefix).unwrap_or_default(),
        };
        let mut rows =
            ech_db_guest::Host::range_raw(&ech_db_guest::Range::kv(start.clone(), Some(end)));
        rows.retain(|(key, _)| key.as_slice() > start.as_slice());
        let mut out = Vec::new();
        for (key, value) in rows {
            if key.len() <= prefix.len() {
                continue;
            }
            let Some(key) = K::decode(&key[prefix.len()..]) else {
                continue;
            };
            out.push((
                key,
                bcs::from_bytes(&value)
                    .map_err(|error| format!("table row: {error}").into_bytes())?,
            ));
            if out.len() == limit {
                break;
            }
        }
        Ok(out)
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl<K: Key, V: Serialize + DeserializeOwned> Table<K, V> {
    pub fn get(&self, _key: &K) -> Result<Option<V>> {
        unimplemented!("entity tables require the wasm runtime")
    }

    pub fn get_many(&self, _keys: &[K]) -> Result<Vec<Option<V>>> {
        unimplemented!("entity tables require the wasm runtime")
    }

    pub fn get_batch(_entries: &[(&Self, &K)]) -> Result<Vec<Option<V>>> {
        unimplemented!("entity tables require the wasm runtime")
    }

    pub fn insert(&self, _key: &K, _value: &V) -> Result<()> {
        unimplemented!("entity tables require the wasm runtime")
    }

    pub fn remove(&self, _key: &K) -> Result<()> {
        unimplemented!("entity tables require the wasm runtime")
    }

    pub fn entries(&self, _after: Option<&K>, _limit: usize) -> Result<Vec<(K, V)>> {
        unimplemented!("entity tables require the wasm runtime")
    }

    pub fn range(&self, _from: Option<&K>, _to: Option<&K>, _limit: usize) -> Result<Vec<(K, V)>> {
        unimplemented!("entity tables require the wasm runtime")
    }
}

#[derive(Serialize, serde::Deserialize)]
#[serde(bound = "")]
pub struct TableVec<V> {
    #[serde(skip)]
    rows: Table<u64, V>,
    length: u64,
}

impl<V> TableVec<V> {
    pub fn new() -> Self {
        Self {
            rows: Table::new(),
            length: 0,
        }
    }

    pub fn len(&self) -> u64 {
        self.length
    }

    pub fn is_empty(&self) -> bool {
        self.length == 0
    }
}

impl<V> Default for TableVec<V> {
    fn default() -> Self {
        Self::new()
    }
}

impl<V> Clone for TableVec<V> {
    fn clone(&self) -> Self {
        Self {
            rows: self.rows.clone(),
            length: self.length,
        }
    }
}

impl<V> PartialEq for TableVec<V> {
    fn eq(&self, other: &Self) -> bool {
        self.rows == other.rows && self.length == other.length
    }
}

impl<V> Eq for TableVec<V> {}

impl<V> fmt::Debug for TableVec<V> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "TableVec(len={})", self.length)
    }
}

impl<V> Bind for TableVec<V> {
    fn bind(&mut self, owner: &[u8; 32], field: &str) {
        self.rows.bind(owner, field);
    }
}

#[cfg(target_arch = "wasm32")]
impl<V: Serialize + DeserializeOwned> TableVec<V> {
    pub fn push(&mut self, value: &V) -> Result<u64> {
        let index = self.length;
        self.rows.insert(&index, value)?;
        self.length = index + 1;
        Ok(index)
    }

    pub fn get(&self, index: u64) -> Result<Option<V>> {
        self.rows.get(&index)
    }

    pub fn tail(&self, before: Option<u64>, limit: usize) -> Result<Vec<(u64, V)>> {
        let end = match before {
            Some(value) => value.min(self.length),
            None => self.length,
        };
        if end == 0 || limit == 0 {
            return Ok(Vec::new());
        }
        let start = end.saturating_sub(limit as u64);
        let from = start.checked_sub(1);
        let mut rows = self.rows.range(from.as_ref(), Some(&end), limit)?;
        rows.sort_by_key(|(index, _)| *index);
        rows.reverse();
        Ok(rows)
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl<V: Serialize + DeserializeOwned> TableVec<V> {
    pub fn push(&mut self, _value: &V) -> Result<u64> {
        unimplemented!("entity tables require the wasm runtime")
    }

    pub fn get(&self, _index: u64) -> Result<Option<V>> {
        unimplemented!("entity tables require the wasm runtime")
    }

    pub fn tail(&self, _before: Option<u64>, _limit: usize) -> Result<Vec<(u64, V)>> {
        unimplemented!("entity tables require the wasm runtime")
    }
}

pub trait Bind {
    fn bind(&mut self, owner: &[u8; 32], field: &str);
}

macro_rules! bind_noop {
    ($($ty:ty),* $(,)?) => {
        $(impl Bind for $ty {
            fn bind(&mut self, _owner: &[u8; 32], _field: &str) {}
        })*
    };
}

bind_noop!(
    u8,
    u16,
    u32,
    u64,
    u128,
    i8,
    i16,
    i32,
    i64,
    bool,
    String,
    ech_db_protocol::value::Esid
);

impl<const N: usize> Bind for [u8; N] {
    fn bind(&mut self, _owner: &[u8; 32], _field: &str) {}
}

impl<T: Bind> Bind for Option<T> {
    fn bind(&mut self, owner: &[u8; 32], field: &str) {
        if let Some(value) = self {
            value.bind(owner, field);
        }
    }
}

impl<T: Bind> Bind for Vec<T> {
    fn bind(&mut self, owner: &[u8; 32], field: &str) {
        for value in self {
            value.bind(owner, field);
        }
    }
}

impl<A: Bind, B: Bind> Bind for (A, B) {
    fn bind(&mut self, owner: &[u8; 32], field: &str) {
        self.0.bind(owner, field);
        self.1.bind(owner, field);
    }
}

impl<K, V> Bind for Table<K, V> {
    fn bind(&mut self, owner: &[u8; 32], field: &str) {
        self.prefix = Some(table_prefix(owner, field));
    }
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
        let write = current_write().ok_or_else(|| b"missing write context".to_vec())?;
        if self.value.version() != T::CURRENT {
            return Err(b"entity version is not current".to_vec());
        }
        let id = self.id();
        let sequence = next_sequence(&id);
        self.seq = sequence;
        let raw =
            bcs::to_bytes(&*self).map_err(|error| format!("save entity: {error}").into_bytes())?;
        ech_db_guest::Host::put(&payload_key(&id), &raw);
        record_history(&id, sequence, &write.txid);
        change(T::NAMESPACE, id, raw);
        Ok(())
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
    record_history(&id, sequence, &write.txid);
}

#[cfg(target_arch = "wasm32")]
fn next_sequence(id: &[u8; 32]) -> u64 {
    let count_key = history_count_key(id);
    let count = ech_db_guest::Host::get::<u64>(&[ech_db_guest::ReadKey::kv(count_key.clone())])
        .pop()
        .flatten()
        .unwrap_or(0);
    let sequence = count + 1;
    ech_db_guest::Host::put_value(&count_key, &sequence);
    sequence
}

#[cfg(target_arch = "wasm32")]
fn record_history(id: &[u8; 32], sequence: u64, txid: &[u8; 32]) {
    ech_db_guest::Host::put(&history_data_key(id, sequence), txid);
}

#[cfg(not(target_arch = "wasm32"))]
fn touch<T: Record>(_id: [u8; 32]) {}

#[cfg(target_arch = "wasm32")]
pub fn read_raw(key: &[u8]) -> Result<Option<Vec<u8>>> {
    let mut values = ech_db_guest::Host::get_raw(&[ech_db_guest::ReadKey::kv(key.to_vec())]);
    Ok(values.pop().flatten())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn read_raw(_key: &[u8]) -> Result<Option<Vec<u8>>> {
    unimplemented!("entity objects require the wasm runtime")
}

#[cfg(target_arch = "wasm32")]
pub fn load<T: Record>(id: &[u8; 32]) -> Result<Option<Entity<T>>> {
    decode_entity(id, read_raw(&payload_key(id))?)
}

#[cfg(target_arch = "wasm32")]
fn decode_entity<T: Record>(id: &[u8; 32], raw: Option<Vec<u8>>) -> Result<Option<Entity<T>>> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let mut entity: Entity<T> =
        bcs::from_bytes(&raw).map_err(|error| format!("load entity: {error}").into_bytes())?;
    if entity.value.version() > T::CURRENT {
        return Err(unsupported_version(entity.value.version(), T::CURRENT));
    }
    if T::id(&entity.key) != *id {
        return Err(b"entity key changed".to_vec());
    }
    entity.value.attach(id);
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
    let keys: Vec<ech_db_guest::ReadKey> = ids
        .iter()
        .map(|id| ech_db_guest::ReadKey::kv(payload_key(id)))
        .collect();
    let values = ech_db_guest::Host::get_raw(&keys);
    ids.iter()
        .zip(values)
        .map(|(id, raw)| decode_entity(id, raw))
        .collect()
}

#[cfg(not(target_arch = "wasm32"))]
pub fn load_many<T: Record>(_ids: &[[u8; 32]]) -> Result<Vec<Option<Entity<T>>>> {
    unimplemented!("entity objects require the wasm runtime")
}

#[cfg(target_arch = "wasm32")]
pub fn load_pair<A: Record, B: Record>(a: &A::Key, b: &B::Key) -> Result<(Entity<A>, Entity<B>)> {
    let a = A::id(a);
    let b = B::id(b);
    let keys = [
        ech_db_guest::ReadKey::kv(payload_key(&a)),
        ech_db_guest::ReadKey::kv(payload_key(&b)),
    ];
    let mut values = ech_db_guest::Host::get_raw(&keys).into_iter();
    let a = decode_entity::<A>(&a, values.next().flatten())?.ok_or_else(A::missing)?;
    let b = decode_entity::<B>(&b, values.next().flatten())?.ok_or_else(B::missing)?;
    Ok((a, b))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn load_pair<A: Record, B: Record>(_a: &A::Key, _b: &B::Key) -> Result<(Entity<A>, Entity<B>)> {
    unimplemented!("entity objects require the wasm runtime")
}

#[cfg(target_arch = "wasm32")]
pub fn insert<T: Record>(key: T::Key, mut value: T, id: &[u8; 32]) -> Result<Entity<T>> {
    value.attach(id);
    let write = current_write().ok_or_else(|| b"missing write context".to_vec())?;
    let sequence = next_sequence(id);
    let entity = Entity {
        genesis: write.tx,
        key,
        value,
        seq: sequence,
    };
    let raw =
        bcs::to_bytes(&entity).map_err(|error| format!("insert entity: {error}").into_bytes())?;
    ech_db_guest::Host::put(&payload_key(id), &raw);
    ech_db_guest::Host::put(&type_key(T::NAMESPACE, id), &[]);
    record_history(id, sequence, &write.txid);
    change(T::NAMESPACE, *id, raw);
    Ok(entity)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn insert<T: Record>(_key: T::Key, _value: T, _id: &[u8; 32]) -> Result<Entity<T>> {
    unimplemented!("entity objects require the wasm runtime")
}

#[cfg(target_arch = "wasm32")]
pub fn scan<T: Record>() -> Result<Vec<Entity<T>>> {
    let prefix = type_prefix(T::NAMESPACE);
    let Some(end) = ech_db_guest::Prefix::successor(&prefix) else {
        return Ok(Vec::new());
    };
    let rows = ech_db_guest::Host::range_raw(&ech_db_guest::Range::kv(prefix.clone(), Some(end)));
    let mut ids = Vec::new();
    for (key, _) in rows {
        if key.len() != prefix.len() + 32 {
            continue;
        }
        let Ok(id) = <[u8; 32]>::try_from(&key[prefix.len()..]) else {
            continue;
        };
        ids.push(id);
    }
    Ok(load_many::<T>(&ids)?.into_iter().flatten().collect())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn scan<T: Record>() -> Result<Vec<Entity<T>>> {
    unimplemented!("entity objects require the wasm runtime")
}

#[cfg(target_arch = "wasm32")]
pub fn load_history(id: &[u8; 32], before: Option<u64>, limit: u32) -> Result<Vec<HistoryEntry>> {
    let count = ech_db_guest::Host::get::<u64>(&[ech_db_guest::ReadKey::kv(history_count_key(id))])
        .pop()
        .flatten()
        .unwrap_or(0);
    let end = match before {
        Some(before) => before.saturating_sub(1).min(count),
        None => count,
    };
    let start = end.saturating_sub(limit as u64);
    let mut entries = Vec::new();
    let mut sequence = end;
    while sequence > start {
        let txid = ech_db_guest::Host::get_raw(&[ech_db_guest::ReadKey::kv(history_data_key(
            id, sequence,
        ))])
        .pop()
        .flatten();
        if let Some(txid) = txid {
            let txid = <[u8; 32]>::try_from(txid.as_slice())
                .map_err(|_| format!("history txid length: {}", txid.len()).into_bytes())?;
            entries.push(HistoryEntry { sequence, txid });
        }
        sequence -= 1;
    }
    Ok(entries)
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
    if read_raw(&type_key(namespace, id))?.is_none() {
        return Ok(None);
    }
    read_raw(&payload_key(id))
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
