use proc_macro2::TokenStream;
use quote::quote;
use syn::{punctuated::Punctuated, token::Comma, FnArg, Ident, Pat, Type, TypePath};

/// Information about an `Env` parameter in a function signature.
pub struct EnvParam<'a> {
    /// The identifier of the Env parameter
    pub ident: &'a Ident,
    /// Whether the parameter is a reference type (`&Env` or `&mut Env`)
    pub is_reference: bool,
}

impl EnvParam<'_> {
    /// Returns a token stream that produces a `&Env` reference.
    /// - If the parameter is already a reference (`&Env`), returns the ident as-is
    /// - If the parameter is owned (`Env`), returns `&ident`
    pub fn as_ref_tokens(&self) -> TokenStream {
        let ident = self.ident;
        if self.is_reference {
            quote!(#ident)
        } else {
            quote!(&#ident)
        }
    }
}

/// Finds the `Env` argument in a function signature and returns its info.
pub fn find_env_param(args: &Punctuated<FnArg, Comma>) -> Option<EnvParam<'_>> {
    args.iter().find_map(|arg| {
        let FnArg::Typed(pat_type) = arg else { return None };
        if !is_env_type(&pat_type.ty) {
            return None;
        }
        let Pat::Ident(pat) = pat_type.pat.as_ref() else { return None };
        Some(EnvParam { ident: &pat.ident, is_reference: is_reference_type(&pat_type.ty) })
    })
}

/// Expects the `Env` argument in a function signature and returns its info.
pub fn expect_env_param(args: &Punctuated<FnArg, Comma>) -> EnvParam<'_> {
    find_env_param(args).expect("function must have an Env argument")
}

/// Checks if a type is an `Env` type.
pub fn is_env_type(ty: &Type) -> bool {
    match ty {
        Type::Path(TypePath { path, .. }) => path.segments.last().is_some_and(|seg| seg.ident == "Env"),
        Type::Reference(r) => is_env_type(&r.elem),
        _ => false,
    }
}

/// Checks if a type is a reference type.
fn is_reference_type(ty: &Type) -> bool {
    matches!(ty, Type::Reference(_))
}
