use actix_web::error::ResponseError;
use actix_web::http::StatusCode;
use actix_web::HttpResponse;

use ech_board_program::error::ForumError;
use ech_db_protocol::error::{CodecError, Reject};

use crate::db::DbError;

#[derive(Debug, thiserror::Error)]
pub enum ServerError {
    #[error("content not found")]
    NotFound,
    #[error("{0}")]
    BadRequest(String),
    #[error("program: {0}")]
    Program(String),
    #[error("codec: {0}")]
    Codec(#[from] bcs::Error),
    #[error("protocol: {0}")]
    Protocol(#[from] CodecError),
    #[error("domain: {0}")]
    Domain(#[from] ech_db_sdk::Error),
    #[error("db: {0}")]
    Db(#[from] DbError),
    #[error("store: {0}")]
    Store(String),
}

impl ServerError {
    fn status(&self) -> StatusCode {
        match self {
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::BadRequest(_) | Self::Codec(_) | Self::Protocol(_) => StatusCode::BAD_REQUEST,
            Self::Db(DbError::Reject(Reject::Duplicate)) => StatusCode::CONFLICT,
            Self::Db(DbError::Reject(Reject::BadSignature)) => StatusCode::FORBIDDEN,
            Self::Db(_) => StatusCode::BAD_GATEWAY,
            Self::Domain(_) | Self::Program(_) | Self::Store(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        }
    }

    fn message(&self) -> String {
        match self {
            Self::Db(DbError::Reject(Reject::Application { bytes })) => application(bytes),
            _ => self.to_string(),
        }
    }
}

fn application(bytes: &[u8]) -> String {
    if let Ok(error) = bcs::from_bytes::<ForumError>(bytes) {
        return error.message().to_string();
    }
    if let Ok(message) = bcs::from_bytes::<String>(bytes) {
        return message;
    }
    match std::str::from_utf8(bytes) {
        Ok(message) => message.to_string(),
        Err(_) => "application".to_string(),
    }
}

impl ResponseError for ServerError {
    fn status_code(&self) -> StatusCode {
        self.status()
    }

    fn error_response(&self) -> HttpResponse {
        HttpResponse::build(self.status_code()).json(serde_json::json!({ "error": self.message() }))
    }
}
