use actix_web::error::ResponseError;
use actix_web::http::StatusCode;
use actix_web::HttpResponse;

use ech_board_program::error::ForumError;
use ech_db_protocol::error::{ProtocolError, Reject};
use ech_db_sdk::Error as SdkError;

use crate::db::DbError;

#[derive(Debug, thiserror::Error)]
pub enum DomainError {
    #[error("content not found")]
    NotFound,
    #[error("{0}")]
    BadRequest(String),
    #[error("program: {0}")]
    Program(String),
    #[error("internal: {0}")]
    Internal(String),
    #[error("codec: {0}")]
    Codec(#[from] bcs::Error),
    #[error("protocol: {0}")]
    Protocol(#[from] ProtocolError),
    #[error("domain: {0}")]
    Domain(#[from] SdkError),
    #[error("db: {0}")]
    Db(#[from] DbError),
    #[error("store: {0}")]
    Store(String),
}

impl DomainError {
    fn status(&self) -> StatusCode {
        match self {
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::BadRequest(_) | Self::Codec(_) | Self::Protocol(_) => StatusCode::BAD_REQUEST,
            Self::Db(DbError::Reject(Reject::Duplicate)) => StatusCode::CONFLICT,
            Self::Db(DbError::Reject(Reject::BadSignature)) => StatusCode::FORBIDDEN,
            Self::Db(_) => StatusCode::BAD_GATEWAY,
            Self::Domain(_) | Self::Program(_) | Self::Internal(_) | Self::Store(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        }
    }

    fn message(&self) -> Result<String, DomainError> {
        match self {
            Self::Db(DbError::Reject(Reject::Application { bytes })) => {
                Ok(bcs::from_bytes::<ForumError>(bytes)?.to_string())
            }
            _ => Ok(self.to_string()),
        }
    }
}

impl ResponseError for DomainError {
    fn status_code(&self) -> StatusCode {
        self.status()
    }

    fn error_response(&self) -> HttpResponse {
        let (status, message) = match self.message() {
            Ok(message) => (self.status(), message),
            Err(error) => (error.status(), error.to_string()),
        };
        HttpResponse::build(status).json(serde_json::json!({ "error": message }))
    }
}
