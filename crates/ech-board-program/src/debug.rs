use crate::context::{decode, encode, fail};
use crate::error::ForumError;

pub fn call(function: &str, args: &[u8]) -> Result<Vec<u8>, Vec<u8>> {
    match function {
        "entity" => {
            let (namespace, id): (String, [u8; 32]) = decode(args)?;
            ech_board_entity::load_record(&namespace, &id)?
                .ok_or_else(|| fail(ForumError::NotFound))
        }
        "history" => {
            let (id, before, limit): ([u8; 32], Option<u64>, u32) = decode(args)?;
            encode(&ech_board_entity::load_history(&id, before, limit)?)
        }
        "forum" => encode(&<crate::model::Forum as ech_board_entity::Record>::id(
            &crate::model::ForumKey {},
        )),
        "mode" => encode(&crate::context::read_only()),
        _ => Err(ech_board_entity::unknown_function("debug", function)),
    }
}
