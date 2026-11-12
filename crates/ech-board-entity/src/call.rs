use std::ops::{Deref, DerefMut};

use ech_db_guest::Esid;
use serde::{Deserialize, Deserializer};

use crate::{Entity, EntityError, Stored};

pub(crate) fn invalid() -> EntityError {
    EntityError::InvalidArguments
}

pub trait Prepare {
    fn prepare(&mut self) -> Result<(), EntityError>;
}

impl Prepare for () {
    fn prepare(&mut self) -> Result<(), EntityError> {
        Ok(())
    }
}

macro_rules! value_param {
    ($($ty:ty),* $(,)?) => {
        $(impl Prepare for $ty {
            fn prepare(&mut self) -> Result<(), EntityError> {
                Ok(())
            }
        })*
    };
}

value_param! {
    bool,
    u8,
    u32,
    u64,
    String,
    Esid,
}

impl<const LENGTH: usize> Prepare for [u8; LENGTH] {
    fn prepare(&mut self) -> Result<(), EntityError> {
        Ok(())
    }
}

impl<T> Prepare for Option<T> {
    fn prepare(&mut self) -> Result<(), EntityError> {
        Ok(())
    }
}

impl<T> Prepare for Vec<T> {
    fn prepare(&mut self) -> Result<(), EntityError> {
        Ok(())
    }
}

macro_rules! handles {
    ($($handle:ident),* $(,)?) => {
        $(
            pub struct $handle<T: Stored> {
                id: [u8; 32],
                inner: Option<Entity<T>>,
            }

            impl<T: Stored> Prepare for $handle<T> {
                fn prepare(&mut self) -> Result<(), EntityError> {
                    self.inner = Some(Entity::<T>::load_by_id(&self.id)?);
                    Ok(())
                }
            }

            impl<T: Stored> $handle<T> {
                pub fn into_inner(self) -> Entity<T> {
                    self.inner.expect("handle is prepared before the call")
                }
            }

            impl<T: Stored> Deref for $handle<T> {
                type Target = Entity<T>;

                fn deref(&self) -> &Entity<T> {
                    self.inner.as_ref().expect("handle is prepared before the call")
                }
            }

            impl<'de, T: Stored> Deserialize<'de> for $handle<T> {
                fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                    Ok(Self {
                        id: <[u8; 32]>::deserialize(deserializer)?,
                        inner: None,
                    })
                }
            }
        )*
    };
}

handles!(Read, Write);

impl<T: Stored> DerefMut for Write<T> {
    fn deref_mut(&mut self) -> &mut Entity<T> {
        self.inner
            .as_mut()
            .expect("handle is prepared before the call")
    }
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
        impl<$($param: Prepare),+> Prepare for ($($param,)+) {
            #[allow(non_snake_case)]
            fn prepare(&mut self) -> Result<(), EntityError> {
                let ($($param,)+) = self;
                $($param.prepare()?;)+
                Ok(())
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
