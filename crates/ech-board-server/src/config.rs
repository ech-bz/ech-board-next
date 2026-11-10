use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use curve25519_dalek::scalar::Scalar;
use serde::Deserialize;

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("config io: {0}")]
    Io(#[from] std::io::Error),
    #[error("config parse: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("key must be 32 bytes of hex")]
    Key,
    #[error("content concurrency must be positive")]
    Concurrency,
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub listen: SocketAddr,
    pub admin: SocketAddr,
    pub db: String,
    pub key: String,
    pub program: PathBuf,
    pub content: ContentConfig,
    pub geo: GeoConfig,
    pub tripcode: TripcodeConfig,
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeoConfig {
    pub object: String,
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TripcodeConfig {
    pub secret: String,
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContentConfig {
    pub storage: StorageConfig,
    pub cache_bytes: u64,
    pub cache_max_object_bytes: u32,
    pub concurrency: usize,
    pub processing_concurrency: usize,
}

#[derive(Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum StorageConfig {
    Local {
        path: PathBuf,
    },
    S3 {
        endpoint: String,
        region: String,
        bucket: String,
        access_key_id: String,
        secret_access_key: String,
    },
}

impl Config {
    pub fn load(path: &Path) -> Result<Self, ConfigError> {
        let config: Self = serde_json::from_slice(&std::fs::read(path)?)?;
        if config.content.concurrency == 0 || config.content.processing_concurrency == 0 {
            return Err(ConfigError::Concurrency);
        }
        Ok(config)
    }

    pub fn key(&self) -> Result<Scalar, ConfigError> {
        let bytes = hex::decode(&self.key).map_err(|_| ConfigError::Key)?;
        let bytes: [u8; 32] = bytes.try_into().map_err(|_| ConfigError::Key)?;
        Ok(Scalar::from_bytes_mod_order(bytes))
    }
}
