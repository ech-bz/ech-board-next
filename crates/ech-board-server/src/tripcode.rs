use base64::Engine;
use sha1::{Digest, Sha1};

use ech_board_program::context::Tripcode;

use crate::error::ServerError;

pub struct Trips {
    secret: String,
}

impl Trips {
    pub fn new(secret: String) -> Self {
        Self { secret }
    }

    pub fn compute(&self, raw: &str) -> Result<Tripcode, ServerError> {
        if let Some(seed) = raw.strip_prefix("##") {
            return Ok(Tripcode {
                secured: true,
                value: secure(seed, &self.secret)?,
            });
        }
        let Some(seed) = raw.strip_prefix('#') else {
            return Err(ServerError::BadRequest(
                "tripcode must start with # or ##".to_string(),
            ));
        };
        Ok(Tripcode {
            secured: false,
            value: plain(seed)?,
        })
    }
}

fn plain(input: &str) -> Result<String, ServerError> {
    let salt = vichan_salt(input);
    let hash = pwhash::unix::crypt(input, &salt)
        .map_err(|error| ServerError::Internal(format!("tripcode crypt: {error:?}")))?;
    Ok(hash[hash.len().saturating_sub(10)..].to_string())
}

fn secure(input: &str, key: &str) -> Result<String, ServerError> {
    let (encoded, _, had_errors) = encoding_rs::SHIFT_JIS.encode(input);
    if had_errors {
        return Err(ServerError::BadRequest(
            "secure tripcode: shift_jis encoding failed".to_string(),
        ));
    }
    let key_bytes = encoded.as_ref();
    let mut hasher = Sha1::new();
    hasher.update(key_bytes);
    hasher.update(key.as_bytes());
    let digest = hasher.finalize();
    let encoded_digest = base64::engine::general_purpose::STANDARD.encode(digest);
    let salt_part = encoded_digest
        .get(..4)
        .ok_or_else(|| ServerError::Internal("secure tripcode: bad digest".to_string()))?
        .replace('+', ".");
    let setting = format!("_..A.{salt_part}");
    let hash = pwhash::unix::crypt(key_bytes, &setting)
        .map_err(|error| ServerError::Internal(format!("secure tripcode: {error:?}")))?;
    Ok(hash[hash.len().saturating_sub(10)..].to_string())
}

fn vichan_salt(input: &str) -> String {
    let mut padded = input.as_bytes().to_vec();
    padded.extend_from_slice(b"H..");
    let mut salt = [padded[1], padded[2]];
    for byte in &mut salt {
        if !matches!(*byte, b'.'..=b'z') {
            *byte = b'.';
        }
        *byte = match *byte {
            b':' => b'A',
            b';' => b'B',
            b'<' => b'C',
            b'=' => b'D',
            b'>' => b'E',
            b'?' => b'F',
            b'@' => b'G',
            b'[' => b'a',
            b'\\' => b'b',
            b']' => b'c',
            b'^' => b'd',
            b'_' => b'e',
            b'`' => b'f',
            other => other,
        };
    }
    String::from_utf8(salt.to_vec()).expect("tripcode salt is ascii")
}
