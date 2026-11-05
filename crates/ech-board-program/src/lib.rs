#![allow(clippy::too_many_arguments)]

extern crate self as ech_board_program;

pub mod context;
pub mod debug;
pub mod error;
pub mod model;

pub use model::{Board, Forum, Post, Thread};

use ech_board_entity::{Dispatch, Record};
use ech_db_guest::{CallOutput, Request, Root};
use ech_db_protocol::hash::Blake2b256;

use error::ForumError;
use model::Hash;

pub struct Content;

impl Content {
    pub fn hash(bytes: &[u8]) -> Hash {
        Blake2b256::hash(&[bytes])
    }
}

fn route<T: Record + Dispatch<context::Context>>(
    context: &context::Context,
    method: &str,
    args: &[u8],
) -> Result<Vec<u8>, Vec<u8>> {
    let (id, rest) = args
        .split_first_chunk::<32>()
        .ok_or_else(ech_board_entity::invalid_arguments)?;
    T::dispatch(id, context, method, rest)
}

pub fn handle(root: Root, request: Request) -> Result<Vec<u8>, Vec<u8>> {
    ech_board_entity::begin_root(*root.as_array());
    let txid = request
        .tx
        .txid(&root)
        .map_err(|_| context::fail(ForumError::NotAuthorized))?;
    let tx = request.tx.clone();
    context::begin_request(request);
    let context = context::Context::new()?;
    ech_board_entity::begin_write(ech_board_entity::Write {
        txid: *txid.as_array(),
        tx,
    });
    let call = context::call()?;
    let (namespace, function) = call
        .function
        .split_once('.')
        .ok_or_else(|| ech_board_entity::unknown_function("", &call.function))?;
    let result = match namespace {
        "forum" if function == "create" => {
            let (): () = context::decode_arguments(&call.args)?;
            Forum::create(&context)
        }
        "forum" => route::<Forum>(&context, function, &call.args),
        "board" => route::<Board>(&context, function, &call.args),
        "thread" => route::<Thread>(&context, function, &call.args),
        "post" => route::<Post>(&context, function, &call.args),
        "debug" => debug::call(function, &call.args),
        _ => Err(ech_board_entity::unknown_function(namespace, function)),
    }?;
    context::encode(&ech_board_entity::Output {
        result,
        entities: ech_board_entity::take_changes(),
    })
}

#[cfg(target_arch = "wasm32")]
ech_db_guest::export_program!(handle);

pub fn output(result: Result<Vec<u8>, Vec<u8>>) -> CallOutput {
    match result {
        Ok(bytes) => CallOutput::Ok(bytes),
        Err(bytes) => CallOutput::Err(bytes),
    }
}
