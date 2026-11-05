use std::ops::Range;

use actix_web::http::{header, StatusCode};
use actix_web::{web, HttpRequest, HttpResponse, HttpResponseBuilder};
use object_store::GetRange;
use serde::Deserialize;

use crate::content::{self, Key, Kind};
use crate::error::ServerError;
use crate::realtime::App;

#[derive(Deserialize)]
pub struct ContentQuery {
    kind: Option<Kind>,
}

pub async fn content_get(
    app: web::Data<App>,
    hash: web::Path<String>,
    query: web::Query<ContentQuery>,
    req: HttpRequest,
) -> Result<HttpResponse, ServerError> {
    let hash = parse_hash(&hash)?;
    let kind = query.kind.unwrap_or(Kind::Text);
    if !matches!(kind, Kind::Text | Kind::Plaintext) {
        return Err(ServerError::BadRequest("invalid content kind".into()));
    }
    let bytes = match app.content.optional(Key::new(kind, hash)).await? {
        Some(bytes) => bytes,
        None if query.kind.is_none() => app.content.get(Key::new(Kind::Plaintext, hash)).await?,
        None => return Err(ServerError::NotFound),
    };
    let etag = etag(&hash);
    if not_modified(&req, &etag) {
        return Ok(response(StatusCode::NOT_MODIFIED, &etag).finish());
    }
    Ok(response(StatusCode::OK, &etag)
        .content_type("application/octet-stream")
        .body(bytes))
}

pub async fn content_put(
    app: web::Data<App>,
    query: web::Query<ContentQuery>,
    body: web::Bytes,
) -> Result<HttpResponse, ServerError> {
    let kind = query.kind.unwrap_or(Kind::Text);
    if !matches!(kind, Kind::Text | Kind::Plaintext) {
        return Err(ServerError::BadRequest("invalid content kind".into()));
    }
    upload(&app, kind, body).await
}

pub async fn media_put(app: web::Data<App>, body: web::Bytes) -> Result<HttpResponse, ServerError> {
    upload(&app, Kind::Media, body).await
}

async fn upload(app: &App, kind: Kind, bytes: web::Bytes) -> Result<HttpResponse, ServerError> {
    let hash = content::hash(&bytes);
    app.content.upload(Key::new(kind, hash), bytes).await?;
    Ok(HttpResponse::Ok()
        .content_type("application/octet-stream")
        .body(hash.to_vec()))
}

pub async fn media_get(
    app: web::Data<App>,
    hash: web::Path<String>,
    req: HttpRequest,
) -> Result<HttpResponse, ServerError> {
    media(&app, Key::new(Kind::Media, parse_hash(&hash)?), &req).await
}

pub async fn reaction_get(
    app: web::Data<App>,
    hash: web::Path<String>,
    req: HttpRequest,
) -> Result<HttpResponse, ServerError> {
    media(&app, Key::new(Kind::Reaction, parse_hash(&hash)?), &req).await
}

pub async fn metadata_get(
    app: web::Data<App>,
    hash: web::Path<String>,
    req: HttpRequest,
) -> Result<HttpResponse, ServerError> {
    let hash = parse_hash(&hash)?;
    let bytes = app.content.get(Key::new(Kind::MediaMeta, hash)).await?;
    let etag = etag(&hash);
    if not_modified(&req, &etag) {
        return Ok(response(StatusCode::NOT_MODIFIED, &etag).finish());
    }
    Ok(response(StatusCode::OK, &etag)
        .content_type("application/octet-stream")
        .body(bytes))
}

pub async fn thumbnail_get(
    app: web::Data<App>,
    hash: web::Path<String>,
    req: HttpRequest,
) -> Result<HttpResponse, ServerError> {
    let hash = parse_hash(&hash)?;
    let bytes = app.content.get(Key::new(Kind::Thumb, hash)).await?;
    let etag = etag(&hash);
    if not_modified(&req, &etag) {
        return Ok(response(StatusCode::NOT_MODIFIED, &etag).finish());
    }
    Ok(response(StatusCode::OK, &etag)
        .content_type("image/jpeg")
        .body(bytes))
}

async fn media(app: &App, key: Key, req: &HttpRequest) -> Result<HttpResponse, ServerError> {
    let meta = app
        .content
        .metadata(key)
        .await?
        .ok_or(ServerError::NotFound)?;
    let etag = etag(&key.hash);
    if not_modified(req, &etag) {
        return Ok(response(StatusCode::NOT_MODIFIED, &etag).finish());
    }
    let range = match requested_range(req, meta.size, &etag) {
        Ok(range) => range,
        Err(()) => {
            return Ok(HttpResponse::RangeNotSatisfiable()
                .insert_header((header::CONTENT_RANGE, format!("bytes */{}", meta.size)))
                .finish())
        }
    };
    let mut response = response(
        if range.is_some() {
            StatusCode::PARTIAL_CONTENT
        } else {
            StatusCode::OK
        },
        &etag,
    );
    response
        .content_type(meta.mime)
        .insert_header((header::ACCEPT_RANGES, "bytes"));
    let length = match &range {
        Some(range) => {
            response.insert_header((
                header::CONTENT_RANGE,
                format!("bytes {}-{}/{}", range.start, range.end - 1, meta.size),
            ));
            range.end - range.start
        }
        None => meta.size,
    };
    response.insert_header((header::CONTENT_LENGTH, length.to_string()));
    if app.content.cacheable(meta.size) {
        let bytes = app.content.get(key).await?;
        let bytes = match range {
            Some(range) if range.end <= bytes.len() as u64 => {
                bytes.slice(range.start as usize..range.end as usize)
            }
            Some(_) => {
                return Err(ServerError::Store(
                    "media size does not match metadata".into(),
                ))
            }
            None => bytes,
        };
        return Ok(response.body(bytes));
    }
    Ok(response.streaming(
        app.content
            .stream(key, range.map(GetRange::Bounded))
            .await?,
    ))
}

fn requested_range(req: &HttpRequest, size: u64, etag: &str) -> Result<Option<Range<u64>>, ()> {
    if req
        .headers()
        .get(header::IF_RANGE)
        .is_some_and(|value| value.to_str().ok() != Some(etag))
    {
        return Ok(None);
    }
    let Some(value) = req.headers().get(header::RANGE) else {
        return Ok(None);
    };
    let value = value.to_str().map_err(|_| ())?;
    let Some(value) = value.strip_prefix("bytes=") else {
        return Ok(None);
    };
    if value.contains(',') {
        return Ok(None);
    }
    let (start, end) = value.split_once('-').ok_or(())?;
    let range = if start.is_empty() {
        let length = end.parse::<u64>().map_err(|_| ())?;
        size.saturating_sub(length)..size
    } else {
        let start = start.parse::<u64>().map_err(|_| ())?;
        let end = if end.is_empty() {
            size
        } else {
            end.parse::<u64>()
                .map_err(|_| ())?
                .saturating_add(1)
                .min(size)
        };
        start..end
    };
    if range.start >= range.end {
        return Err(());
    }
    Ok(Some(range))
}

fn etag(hash: &[u8; 32]) -> String {
    format!("\"{}\"", hex::encode(hash))
}

fn not_modified(req: &HttpRequest, etag: &str) -> bool {
    req.headers()
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value.split(',').any(|value| {
                matches!(value.trim(), "*") || value.trim().trim_start_matches("W/") == etag
            })
        })
}

fn response(status: StatusCode, etag: &str) -> HttpResponseBuilder {
    let mut response = HttpResponse::build(status);
    response
        .insert_header((header::ETAG, etag))
        .insert_header((header::CACHE_CONTROL, "public, max-age=31536000, immutable"));
    response
}

fn parse_hash(value: &str) -> Result<[u8; 32], ServerError> {
    hex::decode(value.strip_prefix("0x").unwrap_or(value))
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or_else(|| ServerError::BadRequest("invalid content hash".into()))
}
