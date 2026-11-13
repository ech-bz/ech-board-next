use std::cell::RefCell;

use bcs::{from_bytes, to_bytes};
use serde::{Deserialize, Serialize};

#[cfg(target_arch = "wasm32")]
use ech_db_guest::Host;
use ech_db_guest::{Author, Call, Esid, Request};

use crate::error::{ForumError, Result};

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct Tripcode {
    pub secured: bool,
    pub value: String,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct ServerContext {
    pub time: u64,
    pub country: Option<u32>,
    pub trip: Option<Tripcode>,
}

impl ServerContext {
    pub fn decode(bytes: &[u8]) -> Result<Self> {
        from_bytes(bytes).map_err(|_| ForumError::NotAuthorized)
    }

    pub fn encode(&self) -> Vec<u8> {
        to_bytes(self).expect("server context encodes")
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct UserRequests {
    pub geo: bool,
    pub trip: bool,
    pub postcount: bool,
}

impl UserRequests {
    pub fn decode(bytes: &[u8]) -> Result<Self> {
        from_bytes(bytes).map_err(|_| ForumError::NotAuthorized)
    }

    pub fn encode(&self) -> Vec<u8> {
        to_bytes(self).expect("user requests encode")
    }
}

struct State {
    request: Request,
    context: Context,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
}

pub struct Context {
    author: Author,
    time: u64,
    requests: UserRequests,
}

impl Context {
    fn new(request: &Request) -> Result<Self> {
        let requests = UserRequests::decode(&request.tx.user.ctx)?;
        let server = ServerContext::decode(&request.tx.server.ctx)?;
        if [
            (requests.geo, server.country.is_some()),
            (requests.trip, server.trip.is_some()),
        ]
        .into_iter()
        .any(|(requested, provided)| requested != provided)
        {
            return Err(ForumError::NotAuthorized);
        }
        Ok(Self {
            author: request.tx.user.author.clone(),
            time: server.time,
            requests,
        })
    }

    pub fn begin(request: Request) -> Result<()> {
        let context = Self::new(&request)?;
        STATE.with(|slot| *slot.borrow_mut() = Some(State { request, context }));
        Ok(())
    }

    #[cfg(target_arch = "wasm32")]
    pub fn read_only() -> bool {
        Host::read_only()
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn read_only() -> bool {
        unimplemented!("program requires the wasm runtime")
    }

    pub fn call() -> Result<Call> {
        Self::state(|state| state.request.tx.user.call.clone())
    }

    pub fn time() -> Result<u64> {
        Self::state(|state| state.context.time)
    }

    pub fn requests() -> Result<UserRequests> {
        Self::state(|state| state.context.requests)
    }

    pub fn esid() -> Result<Esid> {
        Self::state(|state| match state.context.author {
            Author::User { esid, .. } => Some(esid),
            Author::Server => None,
        })?
        .ok_or(ForumError::NotAuthorized)
    }

    pub fn sid(esid: &Esid) -> Result<[u8; 32]> {
        Self::state(|state| {
            state
                .request
                .decryptions
                .get(esid)
                .map(|decryption| decryption.sid)
        })?
        .ok_or(ForumError::NotAuthorized)
    }

    pub fn author_sid() -> Result<[u8; 32]> {
        let esid = Self::esid()?;
        Self::sid(&esid)
    }

    pub fn is_server() -> Result<bool> {
        Self::state(|state| matches!(state.context.author, Author::Server))
    }

    pub fn is_author(author: &Esid) -> Result<bool> {
        Self::state(|state| match state.context.author {
            Author::User { esid, .. } => esid == *author,
            Author::Server => false,
        })
    }

    fn state<T>(f: impl FnOnce(&State) -> T) -> Result<T> {
        STATE.with(|slot| {
            let slot = slot.borrow();
            let state = slot.as_ref().ok_or(ForumError::NotAuthorized)?;
            Ok(f(state))
        })
    }
}
