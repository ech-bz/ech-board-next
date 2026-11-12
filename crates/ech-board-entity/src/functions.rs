use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::call::{invalid, Func, Prepare};
use crate::EntityError;

type Entry<E> = Box<dyn Fn(&[u8]) -> Result<Vec<u8>, E>>;

fn route<F, Ps, T, E>(function: F) -> impl Fn(&[u8]) -> Result<T, E>
where
    F: Func<Ps>,
    Ps: DeserializeOwned + Prepare,
    E: From<EntityError>,
    F::Output: Into<Result<T, E>>,
{
    move |args| {
        let mut params: Ps = bcs::from_bytes(args).map_err(|_| invalid())?;
        params.prepare()?;
        function.call(params).into()
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
    pub fn add<F, Ps, T>(&mut self, name: &'static str, function: F)
    where
        F: Func<Ps> + 'static,
        Ps: DeserializeOwned + Prepare + 'static,
        T: Serialize + 'static,
        F::Output: Into<Result<T, E>>,
    {
        let call = route(function);
        self.entries.push((
            name,
            Box::new(move |args| {
                let value = call(args)?;
                Ok(bcs::to_bytes(&value).expect("output encodes"))
            }),
        ));
    }

    pub fn add_raw<F, Ps>(&mut self, name: &'static str, function: F)
    where
        F: Func<Ps> + 'static,
        Ps: DeserializeOwned + Prepare + 'static,
        F::Output: Into<Result<Vec<u8>, E>>,
    {
        let call = route(function);
        self.entries.push((name, Box::new(call)));
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
