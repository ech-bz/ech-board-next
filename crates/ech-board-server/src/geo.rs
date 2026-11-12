use std::net::IpAddr;

use crate::content::Store;
use crate::error::DomainError;

pub struct Geo {
    reader: maxminddb::Reader<Vec<u8>>,
}

impl Geo {
    pub async fn load(store: &Store, object: &str) -> Result<Self, DomainError> {
        Self::from_bytes(store.read(object).await?.to_vec())
    }

    fn from_bytes(bytes: Vec<u8>) -> Result<Self, DomainError> {
        Ok(Self {
            reader: maxminddb::Reader::from_source(bytes)
                .map_err(|error| DomainError::Internal(format!("geo database: {error}")))?,
        })
    }

    pub fn country(&self, ip: IpAddr) -> Option<u32> {
        self.reader
            .lookup(ip)
            .ok()
            .and_then(|result| result.decode::<maxminddb::geoip2::Country>().ok().flatten())
            .and_then(|country| country.country.iso_code)
            .and_then(iso3166::Country::from_alpha2)
            .map(|country| country.id as u32)
    }
}
