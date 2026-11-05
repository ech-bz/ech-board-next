use std::path::Path;
use std::process::Output;
use std::time::Duration;

use bytes::Bytes;
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::error::ServerError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaMeta {
    pub mime: String,
    pub width: u32,
    pub height: u32,
    pub duration_ms: Option<u64>,
    pub size: u64,
    pub thumbnail: bool,
}

pub struct PreparedMedia {
    pub meta: MediaMeta,
    pub thumbnail: Option<Bytes>,
}

#[derive(Deserialize)]
struct Probe {
    streams: Vec<ProbeStream>,
    format: ProbeFormat,
}

#[derive(Deserialize)]
struct ProbeStream {
    codec_type: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    duration: Option<String>,
}

#[derive(Deserialize)]
struct ProbeFormat {
    duration: Option<String>,
}

pub async fn prepare(bytes: &[u8], reaction: bool) -> Result<PreparedMedia, ServerError> {
    let mime = mime(bytes);
    if mime == "application/octet-stream" || reaction && !mime.starts_with("image/") {
        return Err(ServerError::BadRequest("unsupported media format".into()));
    }
    let mut meta = MediaMeta {
        mime: mime.into(),
        width: 0,
        height: 0,
        duration_ms: None,
        size: bytes.len() as u64,
        thumbnail: false,
    };
    if mime == "application/pdf" {
        return Ok(PreparedMedia {
            meta,
            thumbnail: None,
        });
    }
    let directory = tempfile::tempdir().map_err(|error| ServerError::Store(error.to_string()))?;
    let path = directory.path().join("media");
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|error| ServerError::Store(error.to_string()))?;
    let probe = probe(&path).await?;
    let visual = probe
        .streams
        .iter()
        .find(|stream| stream.codec_type.as_deref() == Some("video"));
    if let Some(stream) = visual {
        meta.width = stream.width.unwrap_or(0);
        meta.height = stream.height.unwrap_or(0);
    }
    if mime.starts_with("audio/") || mime.starts_with("video/") {
        meta.duration_ms = probe
            .format
            .duration
            .as_deref()
            .or_else(|| {
                probe
                    .streams
                    .iter()
                    .find_map(|stream| stream.duration.as_deref())
            })
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|value| value.is_finite() && *value >= 0.0)
            .map(|value| (value * 1000.0).round() as u64);
    }
    let thumbnail = if mime.starts_with("image/") || mime.starts_with("video/") {
        if meta.width == 0 || meta.height == 0 {
            return Err(ServerError::BadRequest(
                "media dimensions are missing".into(),
            ));
        }
        Some(thumbnail(&path).await?)
    } else {
        None
    };
    meta.thumbnail = thumbnail.is_some();
    Ok(PreparedMedia { meta, thumbnail })
}

async fn probe(path: &Path) -> Result<Probe, ServerError> {
    let output = run(Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,width,height,duration:format=duration",
            "-of",
            "json",
        ])
        .arg(path))
    .await?;
    serde_json::from_slice(&output.stdout)
        .map_err(|error| ServerError::BadRequest(format!("media metadata: {error}")))
}

async fn thumbnail(path: &Path) -> Result<Bytes, ServerError> {
    let output = run(Command::new("ffmpeg")
        .args(["-nostdin", "-v", "error", "-threads", "1", "-i"])
        .arg(path)
        .args([
            "-vf",
            "scale=w='min(220,iw)':h='min(220,ih)':force_original_aspect_ratio=decrease",
            "-frames:v",
            "1",
            "-an",
            "-f",
            "image2pipe",
            "-vcodec",
            "mjpeg",
            "-threads",
            "1",
            "pipe:1",
        ]))
    .await?;
    if output.stdout.is_empty() {
        return Err(ServerError::BadRequest("empty thumbnail".into()));
    }
    Ok(Bytes::from(output.stdout))
}

async fn run(command: &mut Command) -> Result<Output, ServerError> {
    command.kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(30), command.output())
        .await
        .map_err(|_| ServerError::BadRequest("media processing timed out".into()))?
        .map_err(|error| ServerError::Store(format!("media processor: {error}")))?;
    if !output.status.success() {
        return Err(ServerError::BadRequest("invalid media".into()));
    }
    Ok(output)
}

fn mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0xff, 0xd8]) {
        return "image/jpeg";
    }
    if bytes.starts_with(&[0x89, 0x50, 0x4e, 0x47]) {
        return "image/png";
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(&b"WEBP"[..]) {
        return "image/webp";
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return "image/gif";
    }
    if bytes.get(4..8) == Some(&b"ftyp"[..]) {
        return "video/mp4";
    }
    if bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        return "video/webm";
    }
    if bytes.starts_with(b"ID3")
        || bytes.first() == Some(&0xff) && bytes.get(1).is_some_and(|b| b & 0xe0 == 0xe0)
    {
        return "audio/mpeg";
    }
    if bytes.starts_with(b"OggS") {
        return "audio/ogg";
    }
    if bytes.starts_with(b"%PDF") {
        return "application/pdf";
    }
    "application/octet-stream"
}
