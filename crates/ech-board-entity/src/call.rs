use std::ops::{Deref, DerefMut};

use ech_db_guest::Esid;
use serde::de::DeserializeOwned;

use crate::{Entity, EntityError, Stored};

pub(crate) fn invalid() -> EntityError {
    EntityError::InvalidArguments
}

macro_rules! handles {
    ($($handle:ident),* $(,)?) => {
        $(
            pub struct $handle<T: Stored>(Entity<T>);

            impl<T: Stored> $handle<T> {
                pub fn into_inner(self) -> Entity<T> {
                    self.0
                }
            }

            impl<T: Stored> From<Entity<T>> for $handle<T> {
                fn from(entity: Entity<T>) -> Self {
                    Self(entity)
                }
            }

            impl<T: Stored> Deref for $handle<T> {
                type Target = Entity<T>;

                fn deref(&self) -> &Entity<T> {
                    &self.0
                }
            }
        )*
    };
}

handles!(Read, Write);

impl<T: Stored> DerefMut for Write<T> {
    fn deref_mut(&mut self) -> &mut Entity<T> {
        &mut self.0
    }
}

pub trait Argument: 'static {
    type Input: DeserializeOwned;
    type Prepared;
    type Value<'a>;

    fn prepare(input: Self::Input) -> Result<Self::Prepared, EntityError>;
    fn get(value: &mut Self::Prepared) -> Self::Value<'_>;
}

macro_rules! value_arguments {
    ($([$($generics:tt)*] $ty:ty),* $(,)?) => {
        $(
            impl $($generics)* Argument for $ty
            where
                $ty: DeserializeOwned,
            {
                type Input = Self;
                type Prepared = Option<Self>;
                type Value<'a> = Self;

                fn prepare(input: Self) -> Result<Self::Prepared, EntityError> {
                    Ok(Some(input))
                }

                fn get(value: &mut Self::Prepared) -> Self {
                    value.take().expect("argument is passed once")
                }
            }
        )*
    };
}

value_arguments! {
    [] (),
    [] bool,
    [] u8,
    [] u32,
    [] u64,
    [] String,
    [] Esid,
    [<const LENGTH: usize>] [u8; LENGTH],
    [<T: DeserializeOwned + 'static>] Option<T>,
    [<T: DeserializeOwned + 'static>] Vec<T>,
}

impl<T: Stored + 'static> Argument for &'static Read<T> {
    type Input = [u8; 32];
    type Prepared = Read<T>;
    type Value<'a> = &'a Read<T>;

    fn prepare(id: Self::Input) -> Result<Self::Prepared, EntityError> {
        Ok(Entity::<T>::load_by_id(&id)?.into())
    }

    fn get(value: &mut Self::Prepared) -> Self::Value<'_> {
        value
    }
}

impl<T: Stored + 'static> Argument for &'static mut Write<T> {
    type Input = [u8; 32];
    type Prepared = Write<T>;
    type Value<'a> = &'a mut Write<T>;

    fn prepare(id: Self::Input) -> Result<Self::Prepared, EntityError> {
        Ok(Entity::<T>::load_by_id(&id)?.into())
    }

    fn get(value: &mut Self::Prepared) -> Self::Value<'_> {
        value
    }
}

pub trait Arguments: 'static {
    type Input: DeserializeOwned;
    type Prepared;
    type Values<'a>;

    fn prepare(input: Self::Input) -> Result<Self::Prepared, EntityError>;
    fn get(values: &mut Self::Prepared) -> Self::Values<'_>;
}

impl Arguments for () {
    type Input = ();
    type Prepared = ();
    type Values<'a> = ();

    fn prepare(_: ()) -> Result<(), EntityError> {
        Ok(())
    }

    fn get(_: &mut ()) {}
}

pub trait Func<Ps> {
    type Output;

    fn call(&self, params: Ps) -> Self::Output;
}

impl<Fun, R> Func<()> for Fun
where
    Fun: Fn() -> R,
{
    type Output = R;

    fn call(&self, _: ()) -> R {
        self()
    }
}

macro_rules! impl_arity {
    ($($param:ident),+) => {
        impl<$($param: Argument),+> Arguments for ($($param,)+) {
            type Input = ($($param::Input,)+);
            type Prepared = ($($param::Prepared,)+);
            type Values<'a> = ($($param::Value<'a>,)+);

            #[allow(non_snake_case)]
            fn prepare(($($param,)+): Self::Input) -> Result<Self::Prepared, EntityError> {
                Ok(($($param::prepare($param)?,)+))
            }

            #[allow(non_snake_case)]
            fn get(($($param,)+): &mut Self::Prepared) -> Self::Values<'_> {
                ($($param::get($param),)+)
            }
        }

        impl<Fun, R, $($param),+> Func<($($param,)+)> for Fun
        where
            Fun: Fn($($param),+) -> R,
        {
            type Output = R;

            #[allow(non_snake_case)]
            fn call(&self, ($($param,)+): ($($param,)+)) -> R {
                self($($param),+)
            }
        }
    };
}

impl_arity!(A);
impl_arity!(A, B);
impl_arity!(A, B, C);
impl_arity!(A, B, C, D);
impl_arity!(A, B, C, D, E);
impl_arity!(A, B, C, D, E, F);
impl_arity!(A, B, C, D, E, F, G);
impl_arity!(A, B, C, D, E, F, G, H);
