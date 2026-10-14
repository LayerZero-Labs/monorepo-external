//! Derive macro for `RoleType`.
//!
//! Validates enum shape, emits a minimal trait impl, and pins the
//! `#[default]` variant's discriminant to `0` to mirror EVM
//! `DEFAULT_ADMIN_ROLE = 0x00`.

use proc_macro2::TokenStream;
use quote::quote;
use syn::{Attribute, Error, Fields, ItemEnum};

pub fn role_type_derive_impl(input: TokenStream) -> syn::Result<TokenStream> {
    let input = syn::parse2::<ItemEnum>(input)?;
    let name = &input.ident;

    if input.variants.is_empty() {
        return Err(Error::new_spanned(&input, "RoleType enum must have at least one variant"));
    }

    if !has_repr_u8(&input.attrs) {
        return Err(Error::new_spanned(
            &input,
            "RoleType enum must carry `#[repr(u8)]` (single-byte PDA seed)",
        ));
    }

    if let Some(v) = input.variants.iter().find(|v| !matches!(v.fields, Fields::Unit)) {
        return Err(Error::new_spanned(v, "RoleType variants must be unit variants (no fields)"));
    }

    let default_variant = input
        .variants
        .iter()
        .find(|v| v.attrs.iter().any(|a| a.path().is_ident("default")))
        .ok_or_else(|| {
            Error::new_spanned(
                &input,
                "RoleType enums must mark exactly one variant with `#[default]`",
            )
        })?;
    let vname = &default_variant.ident;

    Ok(quote! {
        const _: () = assert!(
            #name::#vname as u8 == 0,
            "RoleType `#[default]` variant must have discriminant 0",
        );
        impl ::rbac::traits::RoleType for #name {}
    })
}

fn has_repr_u8(attrs: &[Attribute]) -> bool {
    attrs.iter().any(|attr| {
        if !attr.path().is_ident("repr") {
            return false;
        }
        let mut found = false;
        let _ = attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("u8") {
                found = true;
            }
            Ok(())
        });
        found
    })
}
