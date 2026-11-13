use serde::{Deserialize, Serialize};

use ech_db_guest::GuestError;

#[derive(Serialize, Deserialize, Debug, thiserror::Error)]
pub enum EntityError {
    #[error("not found")]
    NotFound,
    #[error("invalid arguments")]
    InvalidArguments,
    #[error("missing root context")]
    MissingRoot,
    #[error("unsupported version {stored} is newer than {current}")]
    UnsupportedVersion { stored: u32, current: u32 },
    #[error("entity key changed")]
    KeyChanged,
    #[error("entity decode: {0}")]
    Decode(String),
    #[error("missing write context")]
    MissingWrite,
    #[error("entity version is not current")]
    Outdated,
    #[error("entity encode: {0}")]
    Encode(String),
    #[error("{namespace}: {reason}")]
    Message { namespace: String, reason: String },
    #[error("{namespace}: unknown function {function}")]
    UnknownFunction { namespace: String, function: String },
    #[error(transparent)]
    Guest(#[from] GuestError),
}
