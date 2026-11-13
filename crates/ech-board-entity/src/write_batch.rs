use crate::{Entity, Result, Stored};

#[cfg(target_arch = "wasm32")]
use crate::Bind;
#[cfg(target_arch = "wasm32")]
use ech_db_guest::BigLog;

pub struct WriteBatch {
    #[cfg(target_arch = "wasm32")]
    write: crate::Write,
}

#[cfg(target_arch = "wasm32")]
impl WriteBatch {
    pub fn new() -> Result<Self> {
        let write = crate::Session::current_write().ok_or(crate::EntityError::MissingWrite)?;
        Ok(Self { write })
    }

    pub fn insert<T: Stored>(&mut self, key: T::Key, value: T) -> Result<Entity<T>> {
        let id = T::id(&key);
        let mut entity = Entity {
            history: BigLog::default(),
            genesis: self.write.tx.clone(),
            key,
            value,
        };
        entity.bind(&id);
        entity.history.push(&self.write.txid)?;
        self.store(&id, &entity)?;
        if T::PUBLIC {
            crate::types(T::NAMESPACE).insert(&id)?;
        }
        Ok(entity)
    }

    pub fn save<T: Stored>(&mut self, entity: &mut Entity<T>) -> Result<()> {
        if entity.value.version() != T::CURRENT {
            return Err(crate::EntityError::Outdated);
        }
        let id = entity.id();
        entity.history.push(&self.write.txid)?;
        self.store(&id, entity)
    }

    fn store<T: Stored>(&self, id: &[u8; 32], entity: &Entity<T>) -> Result<()> {
        let raw = serde_bytes::ByteBuf::from(
            bcs::to_bytes(entity).map_err(|error| crate::EntityError::Encode(error.to_string()))?,
        );
        crate::payloads().insert(id, &raw)?;
        if T::PUBLIC {
            crate::change(T::NAMESPACE, *id, raw.into_vec());
        }
        Ok(())
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl WriteBatch {
    pub fn new() -> Result<Self> {
        unimplemented!("entity objects require the wasm runtime")
    }

    pub fn insert<T: Stored>(&mut self, _key: T::Key, _value: T) -> Result<Entity<T>> {
        unimplemented!("entity objects require the wasm runtime")
    }

    pub fn save<T: Stored>(&mut self, _entity: &mut Entity<T>) -> Result<()> {
        unimplemented!("entity objects require the wasm runtime")
    }
}
