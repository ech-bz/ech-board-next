pub use ech_board_entity_macros::entity;
#[doc(hidden)]
pub use ech_db_guest::Bind;
pub use ech_db_guest::GuestError;
#[doc(hidden)]
pub use serde;

pub mod call;
pub mod profile;

mod error;
mod functions;

pub use call::Func;
pub use error::EntityError;
pub use functions::Functions;

mod write_batch;

pub use write_batch::WriteBatch;

use std::ops::{Deref, DerefMut};

use ech_db_guest::BigLog;
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

pub trait Stored: Bind + Serialize + DeserializeOwned + Clone + Sized {
    type Key: Bind + Serialize + DeserializeOwned + Clone;

    const NAMESPACE: &'static str;
    const CURRENT: u32;
    const PUBLIC: bool = true;

    fn id(key: &Self::Key) -> [u8; 32] {
        entity_id(Self::NAMESPACE, key)
    }

    fn version(&self) -> u32;

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
}

#[derive(Clone, Debug, Serialize, serde::Deserialize)]
pub struct Output {
    #[serde(with = "serde_bytes")]
    pub result: Vec<u8>,
    pub entities: Vec<Changed>,
}

#[derive(Clone, Debug, Serialize, serde::Deserialize)]
pub struct HistoryPage {
    pub entries: Vec<Tx>,
    pub next: Option<u64>,
    pub length: u64,
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
fn change(namespace: &str, id: [u8; 32]) {
    CHANGES.with(|changes| {
        let mut changes = changes.borrow_mut();
        if changes
            .iter()
            .any(|entry| entry.id == id && entry.namespace == namespace)
        {
            return;
        }
        changes.push(Changed {
            namespace: namespace.to_string(),
            id,
        });
    });
}

#[derive(Bind, Clone, Serialize, serde::Deserialize)]
#[serde(bound = "")]
pub struct Entity<T: Stored> {
    pub history: BigLog<[u8; 32]>,
    pub genesis: Tx,
    pub key: T::Key,
    pub value: T,
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
    pub fn insert(key: T::Key, value: T) -> Result<Self> {
        WriteBatch::new()?.insert(key, value)
    }

    pub fn save(&mut self) -> Result<()> {
        if self.needs_migration() {
            self.value = self.value.migrate()?;
            let id = T::id(&self.key);
            self.bind(&id);
        }
        WriteBatch::new()?.save(self)
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl<T: Stored> Entity<T> {
    pub fn insert(_key: T::Key, _value: T) -> Result<Self> {
        unimplemented!("entity objects require the wasm runtime")
    }

    pub fn save(&mut self) -> Result<()> {
        unimplemented!("entity objects require the wasm runtime")
    }
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
    profile::measure("entity_bind", || entity.bind(id));
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

pub struct Store;

#[cfg(target_arch = "wasm32")]
impl Store {
    pub fn record(namespace: &str, id: &[u8; 32]) -> Result<Option<Vec<u8>>> {
        if !types(namespace).contains(id)? {
            return Ok(None);
        }
        Ok(payloads().get(id)?.map(serde_bytes::ByteBuf::into_vec))
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl Store {
    pub fn record(_namespace: &str, _id: &[u8; 32]) -> Result<Option<Vec<u8>>> {
        unimplemented!("entity objects require the wasm runtime")
    }
}

fn not_found() -> EntityError {
    EntityError::NotFound
}
