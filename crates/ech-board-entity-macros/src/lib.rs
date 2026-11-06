mod entity;

use proc_macro::TokenStream;

#[proc_macro_attribute]
pub fn entity(args: TokenStream, item: TokenStream) -> TokenStream {
    entity::expand(args.into(), item.into())
        .unwrap_or_else(syn::Error::into_compile_error)
        .into()
}
