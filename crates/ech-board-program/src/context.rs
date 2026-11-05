use std::cell::RefCell;

use bcs::{from_bytes, to_bytes};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use ech_db_guest::{Author, Call, Esid, Request};

use crate::error::ForumError;

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug, Default)]
pub struct ServerContext {
    pub time: u64,
}

thread_local! {
    static REQUEST: RefCell<Option<Request>> = const { RefCell::new(None) };
}

pub fn begin_request(request: Request) {
    REQUEST.with(|slot| *slot.borrow_mut() = Some(request));
}

fn with_request<T>(f: impl FnOnce(&Request) -> Result<T, Vec<u8>>) -> Result<T, Vec<u8>> {
    REQUEST.with(|slot| {
        let slot = slot.borrow();
        let request = slot
            .as_ref()
            .ok_or_else(|| fail(ForumError::NotAuthorized))?;
        f(request)
    })
}

pub fn call() -> Result<Call, Vec<u8>> {
    with_request(|request| Ok(request.tx.user.call.clone()))
}

#[cfg(target_arch = "wasm32")]
pub fn read_only() -> bool {
    ech_db_guest::Host::read_only()
}

#[cfg(not(target_arch = "wasm32"))]
pub fn read_only() -> bool {
    unimplemented!("program requires the wasm runtime")
}

pub struct Context {
    author: Author,
    pub time: u64,
}

impl Context {
    pub fn new() -> Result<Self, Vec<u8>> {
        with_request(|request| {
            let server: ServerContext =
                from_bytes(&request.tx.server.ctx).map_err(|_| fail(ForumError::NotAuthorized))?;
            Ok(Self {
                author: request.tx.user.author.clone(),
                time: server.time,
            })
        })
    }

    pub fn esid(&self) -> Result<Esid, Vec<u8>> {
        match self.author {
            Author::User { esid, .. } => Ok(esid),
            Author::Server => Err(fail(ForumError::NotAuthorized)),
        }
    }

    pub fn sid(&self, esid: &Esid) -> Result<[u8; 32], Vec<u8>> {
        with_request(|request| {
            request
                .decryptions
                .get(esid)
                .map(|decryption| decryption.sid)
                .ok_or_else(|| fail(ForumError::NotAuthorized))
        })
    }

    pub fn author_sid(&self) -> Result<[u8; 32], Vec<u8>> {
        let esid = self.esid()?;
        self.sid(&esid)
    }

    pub fn is_server(&self) -> bool {
        matches!(self.author, Author::Server)
    }

    pub fn is_author(&self, author: &Esid) -> bool {
        match self.author {
            Author::User { esid, .. } => esid == *author,
            Author::Server => false,
        }
    }
}

pub fn decode<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, Vec<u8>> {
    from_bytes(bytes).map_err(|_| fail(ForumError::NotAuthorized))
}

pub fn decode_arguments<T: DeserializeOwned>(args: &[u8]) -> Result<T, Vec<u8>> {
    from_bytes(args).map_err(|_| ech_board_entity::invalid_arguments())
}

pub fn encode<T: Serialize>(value: &T) -> Result<Vec<u8>, Vec<u8>> {
    to_bytes(value).map_err(|_| fail(ForumError::CounterOverflow))
}

pub fn fail(error: ForumError) -> Vec<u8> {
    to_bytes(&error).expect("forum error encodes")
}
