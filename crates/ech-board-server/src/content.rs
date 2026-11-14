mod key;

pub use key::{Key, Kind};

use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Instant;

use bytes::Bytes;
use futures_util::future::try_join_all;
use futures_util::stream::{self, BoxStream, StreamExt};
use moka::future::Cache;
use object_store::aws::AmazonS3Builder;
use object_store::local::LocalFileSystem;
use object_store::{ClientOptions, GetOptions, GetRange, ObjectStore, WriteMultipart};
use tokio::sync::Semaphore;

use ech_board_program::Content;
use ech_db_protocol::hash::Blake2b256;

use crate::config::{ContentConfig, StorageConfig};
use crate::error::DomainError;
use crate::media::{self, MediaMeta};

const STREAM_THRESHOLD: u64 = 5 * 1024 * 1024;

pub struct Store {
    backend: Arc<dyn ObjectStore>,
    cache: Cache<Key, Bytes>,
    cache_max_object_bytes: usize,
    requests: Arc<Semaphore>,
    processing: Semaphore,
}

impl Store {
    pub fn new(config: &ContentConfig) -> Result<Self, DomainError> {
        let backend: Arc<dyn ObjectStore> = match &config.storage {
            StorageConfig::Local { path } => {
                std::fs::create_dir_all(path)
                    .map_err(|error| DomainError::Store(error.to_string()))?;
                Arc::new(LocalFileSystem::new_with_prefix(path).map_err(storage_error)?)
            }
            StorageConfig::S3 {
                endpoint,
                region,
                bucket,
                access_key_id,
                secret_access_key,
            } => Arc::new(
                AmazonS3Builder::new()
                    .with_client_options(ClientOptions::new().with_http2_only())
                    .with_endpoint(endpoint)
                    .with_region(region)
                    .with_bucket_name(bucket)
                    .with_access_key_id(access_key_id)
                    .with_secret_access_key(secret_access_key)
                    .with_allow_http(endpoint.starts_with("http://"))
                    .build()
                    .map_err(storage_error)?,
            ),
        };
        Ok(Self {
            backend,
            cache: Cache::builder()
                .max_capacity(config.cache_bytes)
                .eviction_policy(moka::policy::EvictionPolicy::lru())
                .weigher(|_: &Key, bytes: &Bytes| {
                    u32::try_from(bytes.len().saturating_add(64)).unwrap_or(u32::MAX)
                })
                .build(),
            cache_max_object_bytes: config.cache_max_object_bytes as usize,
            requests: Arc::new(Semaphore::new(config.concurrency)),
            processing: Semaphore::new(config.processing_concurrency),
        })
    }

    fn cached(&self, kind: Kind) -> bool {
        kind != Kind::Media
    }

    pub fn cacheable(&self, kind: Kind, size: u64) -> bool {
        self.cached(kind) && size <= self.cache_max_object_bytes as u64
    }

    pub async fn put(&self, key: Key, bytes: Bytes) -> Result<(), DomainError> {
        let started = Instant::now();
        let _permit = self
            .requests
            .acquire()
            .await
            .map_err(|error| DomainError::Store(error.to_string()))?;
        let wait_ms = started.elapsed().as_secs_f64() * 1000.0;
        let storage_started = Instant::now();
        let result = self.backend.put(&key.path(), bytes.clone().into()).await;
        let storage_ms = storage_started.elapsed().as_secs_f64() * 1000.0;
        if wait_ms + storage_ms >= 250.0 {
            tracing::info!(
                kind = ?key.kind,
                bytes = bytes.len(),
                wait_ms,
                storage_ms,
                success = result.is_ok(),
                "slow content write"
            );
        }
        result.map_err(storage_error)?;
        if self.cacheable(key.kind, bytes.len() as u64) {
            self.cache.insert(key, bytes).await;
        }
        Ok(())
    }

    async fn put_file(&self, key: Key, path: &Path, size: u64) -> Result<(), DomainError> {
        if self.cacheable(key.kind, size) || size < STREAM_THRESHOLD {
            return self.put(key, read_file(path).await?).await;
        }
        let started = Instant::now();
        let _permit = self
            .requests
            .acquire()
            .await
            .map_err(|error| DomainError::Store(error.to_string()))?;
        let wait_ms = started.elapsed().as_secs_f64() * 1000.0;
        let storage_started = Instant::now();
        let result = self.put_stream(key, path).await;
        let storage_ms = storage_started.elapsed().as_secs_f64() * 1000.0;
        if wait_ms + storage_ms >= 250.0 {
            tracing::info!(
                kind = ?key.kind,
                bytes = size,
                wait_ms,
                storage_ms,
                success = result.is_ok(),
                "slow content write"
            );
        }
        result
    }

    async fn put_stream(&self, key: Key, path: &Path) -> Result<(), DomainError> {
        use tokio::io::AsyncReadExt;
        let upload = self
            .backend
            .put_multipart(&key.path())
            .await
            .map_err(storage_error)?;
        let mut writer = WriteMultipart::new(upload);
        let mut file = tokio::fs::File::open(path)
            .await
            .map_err(|error| DomainError::Store(error.to_string()))?;
        let mut buf = vec![0u8; 1024 * 1024];
        loop {
            let read = file
                .read(&mut buf)
                .await
                .map_err(|error| DomainError::Store(error.to_string()))?;
            if read == 0 {
                break;
            }
            writer.wait_for_capacity(4).await.map_err(storage_error)?;
            writer.write(&buf[..read]);
        }
        writer.finish().await.map_err(storage_error)?;
        Ok(())
    }

    pub async fn upload_file(&self, key: Key, path: &Path) -> Result<(), DomainError> {
        match key.kind {
            Kind::Media | Kind::Reaction => {
                let _permit = self
                    .processing
                    .acquire()
                    .await
                    .map_err(|error| DomainError::Store(error.to_string()))?;
                let size = tokio::fs::metadata(path)
                    .await
                    .map_err(|error| DomainError::Store(error.to_string()))?
                    .len();
                let prepared = media::prepare(path, key.kind == Kind::Reaction).await?;
                let meta = Bytes::from(bcs::to_bytes(&prepared.meta)?);
                let mut writes: Vec<
                    Pin<Box<dyn Future<Output = Result<(), DomainError>> + Send + '_>>,
                > = Vec::with_capacity(3);
                writes.push(Box::pin(self.put_file(key, path, size)));
                if let Some(thumbnail) = prepared.thumbnail {
                    writes.push(Box::pin(
                        self.put(Key::new(Kind::Thumb, key.hash), thumbnail),
                    ));
                }
                writes.push(Box::pin(self.put(key.metadata(), meta)));
                try_join_all(writes).await?;
                Ok(())
            }
            _ => self.put_small(key, read_file(path).await?).await,
        }
    }

    pub async fn upload_bytes(&self, key: Key, bytes: Bytes) -> Result<(), DomainError> {
        match key.kind {
            Kind::Media | Kind::Reaction => {
                let directory =
                    tempfile::tempdir().map_err(|error| DomainError::Store(error.to_string()))?;
                let path = directory.path().join("content");
                tokio::fs::write(&path, &bytes)
                    .await
                    .map_err(|error| DomainError::Store(error.to_string()))?;
                self.upload_file(key, &path).await
            }
            _ => self.put_small(key, bytes).await,
        }
    }

    async fn put_small(&self, key: Key, bytes: Bytes) -> Result<(), DomainError> {
        match key.kind {
            Kind::Text => {
                if !crate::postpart::validate(&bytes) {
                    return Err(DomainError::BadRequest("invalid post text".into()));
                }
            }
            Kind::Plaintext => {
                std::str::from_utf8(&bytes)
                    .map_err(|_| DomainError::BadRequest("invalid plaintext".into()))?;
            }
            _ => {
                return Err(DomainError::BadRequest(
                    "derived content cannot be uploaded".into(),
                ))
            }
        }
        self.put(key, bytes).await
    }

    pub async fn get(&self, key: Key) -> Result<Bytes, DomainError> {
        if !self.cached(key.kind) {
            let _permit = self
                .requests
                .acquire()
                .await
                .map_err(|error| DomainError::Store(error.to_string()))?;
            return self
                .backend
                .get(&key.path())
                .await
                .map_err(storage_error)?
                .bytes()
                .await
                .map_err(storage_error);
        }
        let result = self
            .cache
            .try_get_with(key, async {
                let _permit = self
                    .requests
                    .acquire()
                    .await
                    .map_err(|error| DomainError::Store(error.to_string()))?;
                self.backend
                    .get(&key.path())
                    .await
                    .map_err(storage_error)?
                    .bytes()
                    .await
                    .map_err(storage_error)
            })
            .await;
        match result {
            Ok(bytes) => {
                if !self.cacheable(key.kind, bytes.len() as u64) {
                    self.cache.invalidate(&key).await;
                }
                Ok(bytes)
            }
            Err(error) => match error.as_ref() {
                DomainError::NotFound => Err(DomainError::NotFound),
                error => Err(DomainError::Store(error.to_string())),
            },
        }
    }

    pub async fn optional(&self, key: Key) -> Result<Option<Bytes>, DomainError> {
        match self.get(key).await {
            Ok(bytes) => Ok(Some(bytes)),
            Err(DomainError::NotFound) => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub async fn metadata(&self, key: Key) -> Result<Option<MediaMeta>, DomainError> {
        self.optional(key.metadata())
            .await?
            .map(|bytes| bcs::from_bytes(&bytes).map_err(Into::into))
            .transpose()
    }

    pub async fn exists(&self, key: Key) -> Result<bool, DomainError> {
        if self.cache.contains_key(&key) {
            return Ok(true);
        }
        let _permit = self
            .requests
            .acquire()
            .await
            .map_err(|error| DomainError::Store(error.to_string()))?;
        match self.backend.head(&key.path()).await {
            Ok(_) => Ok(true),
            Err(object_store::Error::NotFound { .. }) => Ok(false),
            Err(error) => Err(storage_error(error)),
        }
    }

    pub async fn read(&self, path: &str) -> Result<Bytes, DomainError> {
        let _permit = self
            .requests
            .acquire()
            .await
            .map_err(|error| DomainError::Store(error.to_string()))?;
        self.backend
            .get(&object_store::path::Path::from(path))
            .await
            .map_err(storage_error)?
            .bytes()
            .await
            .map_err(storage_error)
    }

    pub async fn stream(
        &self,
        key: Key,
        range: Option<GetRange>,
    ) -> Result<BoxStream<'static, Result<Bytes, DomainError>>, DomainError> {
        let permit = self
            .requests
            .clone()
            .acquire_owned()
            .await
            .map_err(|error| DomainError::Store(error.to_string()))?;
        let result = self
            .backend
            .get_opts(
                &key.path(),
                GetOptions {
                    range,
                    ..Default::default()
                },
            )
            .await
            .map_err(storage_error)?;
        Ok(stream::unfold(
            (result.into_stream(), permit),
            |(mut body, permit)| async move {
                body.next()
                    .await
                    .map(|chunk| (chunk.map_err(storage_error), (body, permit)))
            },
        )
        .boxed())
    }
}

fn storage_error(error: object_store::Error) -> DomainError {
    match error {
        object_store::Error::NotFound { .. } => DomainError::NotFound,
        error => DomainError::Store(error.to_string()),
    }
}

async fn read_file(path: &Path) -> Result<Bytes, DomainError> {
    tokio::fs::read(path)
        .await
        .map(Bytes::from)
        .map_err(|error| DomainError::Store(error.to_string()))
}

pub async fn hash_file(path: &Path) -> Result<[u8; 32], DomainError> {
    use tokio::io::AsyncReadExt;
    let mut hasher = Blake2b256::start();
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| DomainError::Store(error.to_string()))?;
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let read = file
            .read(&mut buf)
            .await
            .map_err(|error| DomainError::Store(error.to_string()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Ok(hasher.finalize())
}

pub fn hash(bytes: &[u8]) -> [u8; 32] {
    Content::hash(bytes)
}
