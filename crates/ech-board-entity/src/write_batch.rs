use crate::{Entity, Result, Stored};

pub struct WriteBatch {
    #[cfg(target_arch = "wasm32")]
    write: crate::Write,
    #[cfg(target_arch = "wasm32")]
    sequences: std::collections::BTreeMap<[u8; 32], u64>,
}

#[cfg(target_arch = "wasm32")]
impl WriteBatch {
    pub fn new(ids: &[[u8; 32]]) -> Result<Self> {
        let write = crate::Session::current_write().ok_or(crate::EntityError::MissingWrite)?;
        let mut ids = ids.to_vec();
        ids.sort_unstable();
        ids.dedup();
        let counts = crate::history_counts().get_many(&ids)?;
        let sequences = ids
            .into_iter()
            .zip(counts)
            .map(|(id, count)| {
                count
                    .unwrap_or(0)
                    .checked_add(1)
                    .map(|sequence| (id, sequence))
                    .ok_or(crate::EntityError::HistoryOverflow)
            })
            .collect::<Result<_>>()?;
        Ok(Self { write, sequences })
    }

    pub fn insert<T: Stored>(&mut self, key: T::Key, mut value: T) -> Result<Entity<T>> {
        let id = T::id(&key);
        value.attach(&id);
        let entity = Entity {
            genesis: self.write.tx.clone(),
            key,
            value,
            seq: self.sequence(&id)?,
        };
        self.store(&id, &entity)?;
        crate::types(T::NAMESPACE).insert(&id)?;
        Ok(entity)
    }

    pub fn save<T: Stored>(&mut self, entity: &mut Entity<T>) -> Result<()> {
        if entity.value.version() != T::CURRENT {
            return Err(crate::EntityError::Outdated);
        }
        let id = entity.id();
        entity.seq = self.sequence(&id)?;
        self.store(&id, entity)
    }

    fn sequence(&mut self, id: &[u8; 32]) -> Result<u64> {
        self.sequences
            .remove(id)
            .ok_or(crate::EntityError::NotPending)
    }

    fn store<T: Stored>(&self, id: &[u8; 32], entity: &Entity<T>) -> Result<()> {
        let raw = serde_bytes::ByteBuf::from(
            bcs::to_bytes(entity).map_err(|error| crate::EntityError::Encode(error.to_string()))?,
        );
        crate::payloads().insert(id, &raw)?;
        crate::history_counts().insert(id, &entity.seq)?;
        crate::record_history(id, entity.seq, &self.write.txid)?;
        crate::change(T::NAMESPACE, *id, raw.into_vec());
        Ok(())
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl WriteBatch {
    pub fn new(_ids: &[[u8; 32]]) -> Result<Self> {
        unimplemented!("entity objects require the wasm runtime")
    }

    pub fn insert<T: Stored>(&mut self, _key: T::Key, _value: T) -> Result<Entity<T>> {
        unimplemented!("entity objects require the wasm runtime")
    }

    pub fn save<T: Stored>(&mut self, _entity: &mut Entity<T>) -> Result<()> {
        unimplemented!("entity objects require the wasm runtime")
    }
}
