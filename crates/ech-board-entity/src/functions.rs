use serde::Serialize;

use crate::call::{invalid, Arguments, Func};
use crate::EntityError;

type Entry<E> = Box<dyn Fn(&[u8]) -> Result<Vec<u8>, E>>;

pub trait Encode<E> {
    fn encode(self) -> Result<Vec<u8>, E>;
}

impl<T: Serialize, E> Encode<E> for Result<T, E> {
    fn encode(self) -> Result<Vec<u8>, E> {
        let value = self?;
        Ok(bcs::to_bytes(&value).expect("output encodes"))
    }
}

pub struct Functions<E> {
    entries: Vec<(&'static str, Entry<E>)>,
}

impl<E> Functions<E> {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }
}

impl<E: From<EntityError> + 'static> Functions<E> {
    pub fn add<F, Ps>(&mut self, name: &'static str, function: F)
    where
        Ps: Arguments,
        F: Func<Ps> + for<'a> Func<Ps::Values<'a>> + 'static,
        for<'a> <F as Func<Ps::Values<'a>>>::Output: Encode<E>,
    {
        self.entries.push((
            name,
            Box::new(move |args| {
                let input: Ps::Input = bcs::from_bytes(args).map_err(|_| invalid())?;
                let mut params = Ps::prepare(input)?;
                function.call(Ps::get(&mut params)).encode()
            }),
        ));
    }

    pub fn add_raw<F, Ps>(&mut self, name: &'static str, function: F)
    where
        Ps: Arguments,
        F: Func<Ps> + for<'a> Func<Ps::Values<'a>, Output = Result<Vec<u8>, E>> + 'static,
    {
        self.entries.push((
            name,
            Box::new(move |args| {
                let input: Ps::Input = bcs::from_bytes(args).map_err(|_| invalid())?;
                let mut params = Ps::prepare(input)?;
                function.call(Ps::get(&mut params))
            }),
        ));
    }

    pub fn call(&self, name: &str, args: &[u8]) -> Result<Vec<u8>, E> {
        let entry = self
            .entries
            .iter()
            .find(|(entry, _)| *entry == name)
            .map(|(_, entry)| entry)
            .ok_or_else(|| {
                E::from(EntityError::UnknownFunction {
                    namespace: String::new(),
                    function: name.to_string(),
                })
            })?;
        entry(args)
    }
}
