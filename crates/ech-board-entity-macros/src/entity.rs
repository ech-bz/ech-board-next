use proc_macro2::TokenStream;
use quote::quote;
use syn::parse::{Parse, ParseStream};
use syn::{ItemEnum, LitStr, Type};

struct Args {
    key: Type,
    private: bool,
}

impl Parse for Args {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let key = input.parse()?;
        let private = if input.is_empty() {
            false
        } else {
            input.parse::<syn::Token![,]>()?;
            let option: syn::Ident = input.parse()?;
            if option != "private" {
                return Err(syn::Error::new_spanned(option, "expected `private`"));
            }
            true
        };
        Ok(Self { key, private })
    }
}

pub fn expand(args: TokenStream, item: TokenStream) -> syn::Result<TokenStream> {
    let Args { key, private } = syn::parse::Parser::parse2(Args::parse, args)?;
    let public = !private;
    let structure: ItemEnum = syn::parse2(item)?;
    let name = structure.ident.clone();
    let namespace = LitStr::new(&name.to_string().to_lowercase(), name.span());

    let mut versions = Vec::new();
    for (index, variant) in structure.variants.iter().enumerate() {
        let expected = index + 1;
        let version = match variant.ident.to_string().strip_prefix('V') {
            Some(text) => text.parse::<u32>().map_err(|_| {
                syn::Error::new_spanned(&variant.ident, "variant must be named `V<number>`")
            })?,
            None => {
                return Err(syn::Error::new_spanned(
                    &variant.ident,
                    "variant must be named `V<number>`",
                ));
            }
        };
        if version != expected as u32 {
            return Err(syn::Error::new_spanned(
                &variant.ident,
                "versions must start at V1 and have no gaps",
            ));
        }
        let syn::Fields::Unnamed(fields) = &variant.fields else {
            return Err(syn::Error::new_spanned(
                variant,
                "versions require `V<number>(Type)`",
            ));
        };
        if fields.unnamed.len() != 1 {
            return Err(syn::Error::new_spanned(
                variant,
                "versions require exactly one field",
            ));
        }
        let ty = fields.unnamed.first().expect("checked").ty.clone();
        let expected_type = format!("{}{}", name, variant.ident);
        let type_name = match &ty {
            syn::Type::Path(path) if path.qself.is_none() => path
                .path
                .segments
                .last()
                .map(|segment| segment.ident.to_string()),
            _ => None,
        };
        if type_name.as_deref() != Some(expected_type.as_str()) {
            return Err(syn::Error::new_spanned(
                &ty,
                format!("variant type must be `{expected_type}`"),
            ));
        }
        versions.push((variant.ident.clone(), version, ty));
    }
    if versions.is_empty() {
        return Err(syn::Error::new_spanned(
            &structure.ident,
            "at least one version is required",
        ));
    }
    let current = versions.len() as u32;

    let arms = versions.iter().map(|(ident, version, _)| {
        quote! { Self::#ident(_) => #version, }
    });
    let single = if versions.len() == 1 {
        Some(versions[0].2.clone())
    } else {
        None
    };
    let last_ident = versions[versions.len() - 1].0.clone();
    let last_type = versions[versions.len() - 1].2.clone();
    let migrate_arms = (0..versions.len()).map(|index| {
        let ident = &versions[index].0;
        let mut steps = Vec::new();
        let mut current = index;
        while current + 1 < versions.len() {
            let next = &versions[current + 1].2;
            let argument = if current == index {
                quote! { value }
            } else {
                quote! { &value }
            };
            steps.push(quote! {
                let value = ::ech_board_entity::Upgrade::<#next>::upgrade(#argument)?;
            });
            current += 1;
        }
        let finish = if steps.is_empty() {
            quote! { ::core::clone::Clone::clone(value) }
        } else {
            quote! { value }
        };
        quote! {
            Self::#ident(value) => {
                #(#steps)*
                ::core::result::Result::Ok(Self::#last_ident(#finish))
            }
        }
    });
    let single_ident = versions[0].0.clone();
    let deref = match &single {
        Some(ty) => quote! {
            impl ::std::ops::Deref for #name {
                type Target = #ty;

                fn deref(&self) -> &Self::Target {
                    match self {
                        Self::#single_ident(value) => value,
                    }
                }
            }

            impl ::std::ops::DerefMut for #name {
                fn deref_mut(&mut self) -> &mut Self::Target {
                    match self {
                        Self::#single_ident(value) => value,
                    }
                }
            }
        },
        None => quote! {},
    };
    Ok(quote! {
        #structure

        #deref

        impl ::core::convert::From<#last_type> for #name {
            fn from(value: #last_type) -> Self {
                Self::#last_ident(value)
            }
        }

        impl ::ech_board_entity::Stored for #name {
            type Key = #key;

            const NAMESPACE: &'static str = #namespace;
            const CURRENT: u32 = #current;
            const PUBLIC: bool = #public;

            fn version(&self) -> u32 {
                match self {
                    #(#arms)*
                }
            }

            fn migrate(&self) -> ::ech_board_entity::Result<Self> {
                match self {
                    #(#migrate_arms)*
                }
            }
        }
    })
}
