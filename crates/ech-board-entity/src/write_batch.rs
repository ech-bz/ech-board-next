use crate::{Entity, Record, Result};

pub struct WriteBatch {
    #[cfg(target_arch = "wasm32")]
    write: crate::Write,
    #[cfg(target_arch = "wasm32")]
    sequences: std::collections::BTreeMap<[u8; 32], u64>,
}

#[cfg(target_arch = "wasm32")]
impl WriteBatch {
    pub fn new(ids: &[[u8; 32]]) -> Result<Self> {
        let write = crate::current_write().ok_or_else(|| b"missing write context".to_vec())?;
        let mut ids = ids.to_vec();
        ids.sort_unstable();
        ids.dedup();
        let keys: Vec<_> = ids
            .iter()
            .map(|id| ech_db_guest::ReadKey::kv(crate::history_count_key(id)))
            .collect();
        let counts = ech_db_guest::Host::get::<u64>(&keys);
        let sequences = ids
            .into_iter()
            .zip(counts)
            .map(|(id, count)| {
                count
                    .unwrap_or(0)
                    .checked_add(1)
                    .map(|sequence| (id, sequence))
                    .ok_or_else(|| b"entity history overflow".to_vec())
            })
            .collect::<Result<_>>()?;
        Ok(Self { write, sequences })
    }

    pub fn insert<T: Record>(&mut self, key: T::Key, mut value: T) -> Result<Entity<T>> {
        let id = T::id(&key);
        value.attach(&id);
        let entity = Entity {
            genesis: self.write.tx.clone(),
            key,
            value,
            seq: self.sequence(&id)?,
        };
        self.store(&id, &entity)?;
        ech_db_guest::Host::put(&crate::type_key(T::NAMESPACE, &id), &[]);
        Ok(entity)
    }

    pub fn save<T: Record>(&mut self, entity: &mut Entity<T>) -> Result<()> {
        if entity.value.version() != T::CURRENT {
            return Err(b"entity version is not current".to_vec());
        }
        let id = entity.id();
        entity.seq = self.sequence(&id)?;
        self.store(&id, entity)
    }

    fn sequence(&mut self, id: &[u8; 32]) -> Result<u64> {
        self.sequences
            .remove(id)
            .ok_or_else(|| b"entity is not pending in write batch".to_vec())
    }

    fn store<T: Record>(&self, id: &[u8; 32], entity: &Entity<T>) -> Result<()> {
        let raw =
            bcs::to_bytes(entity).map_err(|error| format!("save entity: {error}").into_bytes())?;
        ech_db_guest::Host::put(&crate::payload_key(id), &raw);
        ech_db_guest::Host::put_value(&crate::history_count_key(id), &entity.seq);
        crate::record_history(id, entity.seq, &self.write.txid);
        crate::change(T::NAMESPACE, *id, raw);
        Ok(())
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl WriteBatch {
    pub fn new(_ids: &[[u8; 32]]) -> Result<Self> {
        unimplemented!("entity objects require the wasm runtime")
    }

    pub fn insert<T: Record>(&mut self, _key: T::Key, _value: T) -> Result<Entity<T>> {
        unimplemented!("entity objects require the wasm runtime")
    }

    pub fn save<T: Record>(&mut self, _entity: &mut Entity<T>) -> Result<()> {
        unimplemented!("entity objects require the wasm runtime")
    }
}
