use proc_macro2::TokenStream;
use quote::quote;
use syn::{Data, DeriveInput, Fields};

pub fn expand(input: DeriveInput) -> syn::Result<TokenStream> {
    let name = input.ident;
    let Data::Struct(data) = input.data else {
        return Err(syn::Error::new_spanned(&name, "`Bind` requires a struct"));
    };
    let Fields::Named(fields) = data.fields else {
        return Err(syn::Error::new_spanned(
            &name,
            "`Bind` requires named fields",
        ));
    };
    let body = fields.named.iter().map(|field| {
        let ident = field.ident.as_ref().expect("named field");
        let text = ident.to_string();
        quote! {
            {
                let child: ::std::borrow::Cow<str> = if field.is_empty() {
                    ::std::borrow::Cow::Borrowed(#text)
                } else {
                    ::std::borrow::Cow::Owned(::std::format!("{}/{}", field, #text))
                };
                ::ech_board_entity::Bind::bind(&mut self.#ident, owner, &child);
            }
        }
    });

    Ok(quote! {
        impl ::ech_board_entity::Bind for #name {
            fn bind(&mut self, owner: &[u8; 32], field: &str) {
                #(#body)*
            }
        }
    })
}
