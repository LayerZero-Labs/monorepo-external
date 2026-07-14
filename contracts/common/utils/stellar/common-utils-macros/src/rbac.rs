//! RBAC attribute macros for Stellar contracts.
//!
//! Provides `#[has_role]` and `#[only_role]` for role-based access control,
//! delegating to `utils::rbac::ensure_role`.

use crate::utils;
use proc_macro2::TokenStream;
use quote::{quote, ToTokens};
use syn::parse_quote;
use syn::{
    parse::{Parse, ParseStream},
    Expr, FnArg, Ident, ItemFn, Pat, Token, Type,
};

/// Helper that generates the role check for both `has_role` and `only_role`.
/// If `require_auth` is true, also injects `account.require_auth()`.
pub fn generate_role_check(args: TokenStream, input: TokenStream, require_auth: bool) -> TokenStream {
    let HasRoleArgs { param, role } =
        syn::parse2(args).unwrap_or_else(|e| panic!("failed to parse has_role/only_role args: {}", e));
    let mut input_fn: ItemFn = syn::parse2(input).unwrap_or_else(|e| panic!("failed to parse function: {}", e));

    let is_address_ref = validate_address_type(&input_fn, &param);
    let param_ref = if is_address_ref { quote!(#param) } else { quote!(&#param) };

    let env_param = utils::expect_env_param(&input_fn.sig.inputs);
    let env_ref = env_param.as_ref_tokens();

    // Insert the role check at the beginning of the function body
    input_fn.block.stmts.insert(
        0,
        parse_quote!(utils::rbac::ensure_role::<Self>(#env_ref, &soroban_sdk::Symbol::new(#env_ref, #role), #param_ref);),
    );
    if require_auth {
        input_fn.block.stmts.insert(1, parse_quote!(#param.require_auth();));
    }
    input_fn.into_token_stream()
}

struct HasRoleArgs {
    param: Ident,
    role: Expr,
}

impl Parse for HasRoleArgs {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        // Parse the parameter name (the account identifier to check)
        let param: Ident = input.parse()?;
        // Expect a comma separator between param and role
        input.parse::<Token![,]>()?;
        // Parse the role expression (e.g., a string literal or constant)
        let role: Expr = input.parse()?;
        Ok(HasRoleArgs { param, role })
    }
}

/// Looks up `param_name` in the function signature and validates that its type
/// is `Address` or `&Address`. Returns `true` when the parameter is a reference,
/// so the caller knows whether an extra `&` is needed when forwarding it.
///
/// Panics at macro-expansion time if the parameter doesn't exist.
fn validate_address_type(func: &ItemFn, param_name: &Ident) -> bool {
    for arg in &func.sig.inputs {
        let FnArg::Typed(pat_type) = arg else { continue };
        let Pat::Ident(pat_ident) = &*pat_type.pat else { continue };
        if pat_ident.ident != *param_name {
            continue;
        }
        return match &*pat_type.ty {
            Type::Reference(r) => {
                assert_is_address(&r.elem, param_name);
                true
            }
            ty => {
                assert_is_address(ty, param_name);
                false
            }
        };
    }
    panic!("Parameter `{param_name}` not found in function signature");
}

/// Asserts that the type path resolves to `Address`, panicking otherwise.
fn assert_is_address(ty: &Type, param_name: &Ident) {
    let Type::Path(tp) = ty else {
        panic!("Parameter `{param_name}` must be of type `Address` or `&Address`");
    };
    if tp.path.segments.last().is_none_or(|s| s.ident != "Address") {
        panic!("Parameter `{param_name}` must be of type `Address` or `&Address`");
    }
}
