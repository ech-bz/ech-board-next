#![allow(clippy::too_many_arguments)]

extern crate self as ech_board_program;

pub mod component;
pub mod context;
pub mod debug;
pub mod entity;
pub mod error;
mod registry;
pub mod types;

use ech_board_entity::{profile, Output, Session, Write};
use ech_db_guest::{Request, Root};
use ech_db_protocol::hash::Blake2b256;

use context::Context;
use error::{ForumError, Result};
use types::Hash;

pub struct Content;

impl Content {
    pub fn hash(bytes: &[u8]) -> Hash {
        Blake2b256::hash(&[bytes])
    }
}

pub fn handle(root: Root, request: Request) -> std::result::Result<Vec<u8>, Vec<u8>> {
    run(root, request).map_err(|error| bcs::to_bytes(&error).expect("error encodes"))
}

fn run(root: Root, request: Request) -> Result<Vec<u8>> {
    let txid = request
        .tx
        .txid(&root)
        .map_err(|_| ForumError::NotAuthorized)?;
    let tx = request.tx.clone();
    Context::begin(request)?;
    Session::begin_write(Write {
        txid: *txid.as_array(),
        tx,
    });
    let call = Context::call()?;
    let result = registry::registry().call(&call.function, &call.args)?;
    profile::measure("output_encode", || {
        let output = Output {
            result,
            entities: Session::take_changes(),
        };
        Ok(bcs::to_bytes(&output).expect("output encodes"))
    })
}

#[cfg(target_arch = "wasm32")]
ech_db_guest::export_program!(handle);
