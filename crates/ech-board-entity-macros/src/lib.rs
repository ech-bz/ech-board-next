mod bind;
mod entity;

use proc_macro::TokenStream;

#[proc_macro_attribute]
pub fn entity(args: TokenStream, item: TokenStream) -> TokenStream {
    entity::expand(args.into(), item.into())
        .unwrap_or_else(syn::Error::into_compile_error)
        .into()
}

#[proc_macro_derive(Bind)]
pub fn bind(input: TokenStream) -> TokenStream {
    let input = syn::parse_macro_input!(input as syn::DeriveInput);
    bind::expand(input)
        .unwrap_or_else(syn::Error::into_compile_error)
        .into()
}
