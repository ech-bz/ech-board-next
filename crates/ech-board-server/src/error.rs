use actix_web::HttpResponse;
use actix_web::dev::ServiceResponse;
use actix_web::error::ResponseError;
use actix_web::http::{StatusCode, header};
use actix_web::middleware::ErrorHandlerResponse;
use serde::Serialize;

use ech_db_protocol::error::{ProtocolError, Reject};
use ech_db_sdk::Error as SdkError;

use crate::db::DbError;

const CONTENT_TYPE: &str = "application/octet-stream";

#[derive(Debug, Serialize, thiserror::Error)]
pub enum DomainError {
    #[error("protocol: {0}")]
    Protocol(#[from] ProtocolError),
    #[error("sdk: {0}")]
    Sdk(#[from] SdkError),
    #[error("db: {0}")]
    Db(#[from] DbError),
    #[error("HTTP {status}: {message}")]
    Http { status: u16, message: String },
    #[error("content not found")]
    NotFound,
    #[error("{0}")]
    BadRequest(String),
    #[error("program: {0}")]
    Program(String),
    #[error("internal: {0}")]
    Internal(String),
    #[error("codec: {0}")]
    Codec(String),
    #[error("store: {0}")]
    Store(String),
}

impl From<bcs::Error> for DomainError {
    fn from(error: bcs::Error) -> Self {
        Self::Codec(error.to_string())
    }
}

impl DomainError {
    fn status(&self) -> StatusCode {
        match self {
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::BadRequest(_) | Self::Codec(_) | Self::Protocol(_) => StatusCode::BAD_REQUEST,
            Self::Db(DbError::Reject(Reject::Duplicate)) => StatusCode::CONFLICT,
            Self::Db(DbError::Reject(Reject::BadSignature)) => StatusCode::FORBIDDEN,
            Self::Db(_) => StatusCode::BAD_GATEWAY,
            Self::Http { status, .. } => {
                StatusCode::from_u16(*status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
            }
            Self::Sdk(_) | Self::Program(_) | Self::Internal(_) | Self::Store(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        }
    }
}

impl ResponseError for DomainError {
    fn status_code(&self) -> StatusCode {
        self.status()
    }

    fn error_response(&self) -> HttpResponse {
        HttpResponse::build(self.status())
            .content_type(CONTENT_TYPE)
            .body(bcs::to_bytes(self).expect("DomainError is BCS serializable"))
    }
}

pub fn http_error<B>(response: ServiceResponse<B>) -> actix_web::Result<ErrorHandlerResponse<B>> {
    if response
        .headers()
        .get(header::CONTENT_TYPE)
        .is_some_and(|value| value == CONTENT_TYPE)
    {
        return Ok(ErrorHandlerResponse::Response(
            response.map_into_left_body(),
        ));
    }
    let status = response.status();
    let error = DomainError::Http {
        status: status.as_u16(),
        message: response
            .response()
            .error()
            .map(ToString::to_string)
            .unwrap_or_else(|| {
                status
                    .canonical_reason()
                    .unwrap_or("HTTP error")
                    .to_string()
            }),
    };
    let (request, mut response) = response.into_parts();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static(CONTENT_TYPE),
    );
    response.headers_mut().remove(header::CONTENT_LENGTH);
    response.headers_mut().remove(header::CONTENT_ENCODING);
    Ok(ErrorHandlerResponse::Response(
        ServiceResponse::new(
            request,
            response.set_body(error.error_response().into_body()),
        )
        .map_into_right_body(),
    ))
}
