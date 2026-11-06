use bcs::{from_bytes, to_bytes};
use reqwest::Client;
use serde::de::DeserializeOwned;
use tracing::Instrument;

use ech_db_protocol::error::Reject;
use ech_db_protocol::id::{Root, Txid};
use ech_db_protocol::value::{Outcome, Record, Request};

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("reject: {0:?}")]
    Reject(Reject),
    #[error("status {0}")]
    Status(u16),
    #[error("transport: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("codec: {0}")]
    Codec(#[from] bcs::Error),
}

pub struct DbClient {
    http: Client,
    base: String,
}

impl DbClient {
    pub fn new(base: String) -> Self {
        Self {
            http: Client::new(),
            base: base.trim_end_matches('/').to_string(),
        }
    }

    pub async fn append(&self, root: &Root, request: &Request) -> Result<Outcome, DbError> {
        let body = to_bytes(request)?;
        let response = self
            .http
            .post(format!("{}/{}/append", self.base, root))
            .header("content-type", "application/octet-stream")
            .body(body)
            .send()
            .await?;
        Self::decode(response).await
    }

    pub async fn query(&self, root: &Root, request: &Request) -> Result<Outcome, DbError> {
        let body = tracing::debug_span!(target: "latency", "query.encode_request")
            .in_scope(|| to_bytes(request))?;
        let size = body.len();
        let response = self
            .http
            .post(format!("{}/{}/query", self.base, root))
            .header("content-type", "application/octet-stream")
            .body(body)
            .send()
            .instrument(
                tracing::debug_span!(target: "latency", "query.http_headers", request_bytes = size),
            )
            .await?;
        Self::decode(response).await
    }

    pub async fn history(
        &self,
        root: &Root,
        dir: &str,
        from: Option<Txid>,
        limit: u64,
    ) -> Result<Vec<Record>, DbError> {
        let mut url = format!("{}/{}/tx?dir={}&limit={}", self.base, root, dir, limit);
        if let Some(txid) = from {
            url.push_str(&format!("&from={txid}"));
        }
        let response = self.http.get(url).send().await?;
        Self::decode(response).await
    }

    async fn decode<T: DeserializeOwned>(response: reqwest::Response) -> Result<T, DbError> {
        let status = response.status();
        let bytes = response
            .bytes()
            .instrument(
                tracing::debug_span!(target: "latency", "db.http_body", status = status.as_u16()),
            )
            .await?;
        tracing::debug_span!(target: "latency", "db.decode_response", bytes = bytes.len()).in_scope(
            || {
                if status.is_success() {
                    return Ok(from_bytes(&bytes)?);
                }
                match from_bytes::<Reject>(&bytes) {
                    Ok(reject) => Err(DbError::Reject(reject)),
                    Err(_) => Err(DbError::Status(status.as_u16())),
                }
            },
        )
    }
}
