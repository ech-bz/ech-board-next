use std::time::Instant;

use bcs::{from_bytes, to_bytes};
use reqwest::Client;
use serde::de::DeserializeOwned;
use tracing::Instrument;

use ech_db_protocol::error::Reject;
use ech_db_protocol::id::{Root, Txid};
use ech_db_protocol::value::{Esid, Outcome, Record, Request};

use crate::timing::{self, Timer};

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
    pub fn new(base: String) -> Result<Self, DbError> {
        Ok(Self {
            http: Client::builder().http2_prior_knowledge().build()?,
            base: base.trim_end_matches('/').to_string(),
        })
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
        let encode = Timer::new("request_encode");
        let body = tracing::debug_span!(target: "latency", "query.encode_request")
            .in_scope(|| to_bytes(request))?;
        let size = body.len();
        drop(encode);
        let http_started = Instant::now();
        let http = Timer::new("db_http");
        let headers = Timer::new("db_wait");
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
        drop(headers);
        timing::extra(format!("db_protocol;desc=\"{:?}\"", response.version()));
        let mut db_ms = None;
        for value in response.headers().get_all("server-timing") {
            if let Ok(value) = value.to_str() {
                if value.len() <= 4096 {
                    for metric in value.split(',').map(str::trim) {
                        if metric.starts_with("db;") {
                            db_ms = metric.split(';').find_map(|parameter| {
                                parameter
                                    .trim()
                                    .strip_prefix("dur=")?
                                    .parse::<f64>()
                                    .ok()
                                    .filter(|duration| duration.is_finite() && *duration >= 0.0)
                            });
                        }
                        if metric.starts_with("db;") || metric.starts_with("db_") {
                            timing::extra(metric.to_string());
                        }
                    }
                }
            }
        }
        let status = response.status();
        let bytes = timing::measure_async(
            "db_receive",
            response.bytes().instrument(
                tracing::debug_span!(target: "latency", "db.http_body", status = status.as_u16()),
            ),
        )
        .await?;
        let http_ms = http_started.elapsed().as_secs_f64() * 1000.0;
        drop(http);
        if let Some(db_ms) = db_ms.filter(|duration| *duration <= http_ms) {
            timing::extra(format!("db_outside;dur={:.3}", http_ms - db_ms));
        } else {
            timing::extra("db_timing_unavailable".to_string());
        }
        timing::measure("response_decode", || Self::decode_bytes(status, &bytes))
    }

    pub async fn history(
        &self,
        root: &Root,
        dir: &str,
        from: Option<Txid>,
        limit: u64,
        esid: Option<&Esid>,
    ) -> Result<(Vec<Record>, Option<u64>), DbError> {
        let mut url = format!("{}/{}/tx?dir={}&limit={}", self.base, root, dir, limit);
        if let Some(txid) = from {
            url.push_str(&format!("&from={txid}"));
        }
        if let Some(esid) = esid {
            url.push_str(&format!("&esid={}", hex::encode(to_bytes(esid)?)));
        }
        let response = self.http.get(url).send().await?;
        let length = response
            .headers()
            .get("x-history-length")
            .map(|value| {
                value
                    .to_str()
                    .ok()
                    .and_then(|value| value.parse().ok())
                    .ok_or(DbError::Reject(Reject::Integrity))
            })
            .transpose()?;
        let records = Self::decode(response).await?;
        if esid.is_some() && from.is_none() && length.is_none() {
            return Err(DbError::Reject(Reject::Integrity));
        }
        Ok((records, length))
    }

    async fn decode<T: DeserializeOwned>(response: reqwest::Response) -> Result<T, DbError> {
        let status = response.status();
        let bytes = response
            .bytes()
            .instrument(
                tracing::debug_span!(target: "latency", "db.http_body", status = status.as_u16()),
            )
            .await?;
        Self::decode_bytes(status, &bytes)
    }

    fn decode_bytes<T: DeserializeOwned>(
        status: reqwest::StatusCode,
        bytes: &[u8],
    ) -> Result<T, DbError> {
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
