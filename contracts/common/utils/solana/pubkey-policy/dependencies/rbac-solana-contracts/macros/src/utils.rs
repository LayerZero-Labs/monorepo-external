//! Shared utilities for struct-injection macros (`init_default_admin`, `only_role`).

use darling::FromMeta;
use syn::{Data, DeriveInput, Fields, FieldsNamed, ItemStruct, Meta};

/// Wrapper for any expression in macro attributes.
/// Supports both paths (`RoleType::Admin`) and field access (`params.role`, `account.key()`).
#[derive(Debug, Clone)]
pub struct ExprArg(pub syn::Expr);

impl FromMeta for ExprArg {
    fn from_meta(item: &Meta) -> darling::Result<Self> {
        match item {
            Meta::NameValue(nv) => Ok(ExprArg(nv.value.clone())),
            _ => Err(darling::Error::unsupported_format("expected name = expression")),
        }
    }
}

/// Get a mutable reference to the named fields, rejecting tuple and unit structs.
pub fn named_fields_mut(item: &mut ItemStruct) -> syn::Result<&mut FieldsNamed> {
    match &mut item.fields {
        Fields::Named(fields) => Ok(fields),
        _ => Err(syn::Error::new_spanned(&item.ident, "expected named fields")),
    }
}

/// Validates that `input` is a struct with named fields and that all
/// `required_fields` are present.
pub fn validate_named_struct(
    input: &DeriveInput,
    derive_name: &str,
    required_fields: &[&str],
) -> syn::Result<()> {
    let name = &input.ident;

    let Data::Struct(data) = &input.data else {
        return Err(syn::Error::new_spanned(
            name,
            format!("{derive_name} can only be derived for structs"),
        ));
    };
    let Fields::Named(fields) = &data.fields else {
        return Err(syn::Error::new_spanned(
            name,
            format!("{derive_name} can only be derived for structs with named fields"),
        ));
    };

    let missing: Vec<_> = required_fields
        .iter()
        .copied()
        .filter(|req| !fields.named.iter().any(|f| f.ident.as_ref().is_some_and(|id| id == req)))
        .collect();

    if !missing.is_empty() {
        return Err(syn::Error::new_spanned(
            name,
            format!("{derive_name} derive requires missing fields: {}", missing.join(", ")),
        ));
    }

    Ok(())
}
