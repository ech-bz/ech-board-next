use std::path::Path;
use std::process::Output;
use std::time::Duration;

use bytes::Bytes;
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::error::DomainError;

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
    format_name: Option<String>,
}

pub async fn prepare(path: &Path, reaction: bool) -> Result<PreparedMedia, DomainError> {
    let mime = mime(&head(path).await?)?;
    if reaction && !mime.starts_with("image/") {
        return Err(DomainError::BadRequest("unsupported media format".into()));
    }
    let size = tokio::fs::metadata(path)
        .await
        .map_err(|error| DomainError::Store(error.to_string()))?
        .len();
    let mut meta = MediaMeta {
        mime: mime.into(),
        width: 0,
        height: 0,
        duration_ms: None,
        size,
        thumbnail: false,
    };
    if mime == "application/pdf" {
        return Ok(PreparedMedia {
            meta,
            thumbnail: None,
        });
    }
    let probe = probe(path).await?;
    let format = demuxer(&probe)?;
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
            return Err(DomainError::BadRequest(
                "media dimensions are missing".into(),
            ));
        }
        Some(thumbnail(path, format).await?)
    } else {
        None
    };
    meta.thumbnail = thumbnail.is_some();
    Ok(PreparedMedia { meta, thumbnail })
}

async fn head(path: &Path) -> Result<Vec<u8>, DomainError> {
    use tokio::io::AsyncReadExt;
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| DomainError::Store(error.to_string()))?;
    let mut buf = vec![0u8; 512];
    let mut filled = 0;
    while filled < buf.len() {
        let read = file
            .read(&mut buf[filled..])
            .await
            .map_err(|error| DomainError::Store(error.to_string()))?;
        if read == 0 {
            break;
        }
        filled += read;
    }
    buf.truncate(filled);
    Ok(buf)
}

async fn probe(path: &Path) -> Result<Probe, DomainError> {
    let output = run(Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,width,height,duration:format=duration,format_name",
            "-of",
            "json",
        ])
        .arg(path))
    .await?;
    serde_json::from_slice(&output.stdout)
        .map_err(|error| DomainError::BadRequest(format!("media metadata: {error}")))
}

async fn thumbnail(path: &Path, format: &str) -> Result<Bytes, DomainError> {
    let output = run(Command::new("ffmpeg")
        .args([
            "-nostdin", "-v", "error", "-threads", "1", "-f", format, "-i",
        ])
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
        return Err(DomainError::BadRequest("empty thumbnail".into()));
    }
    Ok(Bytes::from(output.stdout))
}

async fn run(command: &mut Command) -> Result<Output, DomainError> {
    command.kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(30), command.output())
        .await
        .map_err(|_| DomainError::BadRequest("media processing timed out".into()))?
        .map_err(|error| DomainError::Store(format!("media processor: {error}")))?;
    if !output.status.success() {
        return Err(DomainError::BadRequest("invalid media".into()));
    }
    Ok(output)
}

fn mime(bytes: &[u8]) -> Result<&'static str, DomainError> {
    if bytes.first() == Some(&0xff)
        && bytes
            .get(1)
            .is_some_and(|b| b & 0xe0 == 0xe0 && (b >> 1) & 3 == 1 && (b >> 3) & 3 != 1)
    {
        return Ok("audio/mpeg");
    }
    match infer::get(bytes).map(|kind| kind.mime_type()) {
        Some(
            known @ ("image/jpeg" | "image/png" | "image/gif" | "image/webp" | "image/avif"
            | "video/mp4" | "video/quicktime" | "video/x-m4v" | "video/webm"
            | "video/x-matroska" | "audio/mpeg" | "audio/aac" | "audio/ogg"
            | "application/pdf"),
        ) => Ok(known),
        _ => Err(DomainError::BadRequest("unsupported media format".into())),
    }
}

pub fn extension(bytes: &[u8]) -> Option<&'static str> {
    Some(match mime(bytes).ok()? {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/avif" => "avif",
        "video/mp4" => "mp4",
        "video/quicktime" => "mov",
        "video/x-m4v" => "m4v",
        "video/webm" => "webm",
        "video/x-matroska" => "mkv",
        "audio/mpeg" => "mp3",
        "audio/aac" => "aac",
        "audio/ogg" => "ogg",
        "application/pdf" => "pdf",
        _ => return None,
    })
}

fn demuxer(probe: &Probe) -> Result<&str, DomainError> {
    probe
        .format
        .format_name
        .as_deref()
        .and_then(|name| name.split(',').next())
        .ok_or_else(|| DomainError::BadRequest("invalid media".into()))
}
