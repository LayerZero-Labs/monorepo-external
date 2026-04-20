//! Authorization macros for Stellar contracts.
//!
//! This module provides macros for implementing authorization patterns:
//! - `#[ownable]` - Owner-based access control (external owner address)
//! - `#[multisig]` - MultiSig-based access control (self-owning pattern)
//! - `#[only_auth]` - Authorization check attribute for functions

use crate::utils;
use proc_macro2::TokenStream;
use quote::{quote, ToTokens};
use syn::{parse_quote, ItemFn, ItemStruct};

// ============================================================================
// Ownable Macro Implementation
// ============================================================================

/// Generates the ownable implementation from the `#[ownable]` attribute macro.
///
/// This macro implements `OwnableInitializer`, `Auth`, and `Ownable` traits for the contract:
/// - `OwnableInitializer` provides `init_owner()` for constructor use
/// - `Auth::authorizer()` returns the stored owner address
/// - `Ownable` provides ownership management (transfer, accept, renounce)
pub fn generate_ownable_impl(input: TokenStream) -> TokenStream {
    let item_struct: ItemStruct = syn::parse2(input).unwrap_or_else(|e| panic!("failed to parse struct: {}", e));
    let name = &item_struct.ident;

    quote! {
        #item_struct

        use utils::{auth::Auth as _, ownable::{Ownable as _, OwnableInitializer as _}};

        impl utils::ownable::OwnableInitializer for #name {}

        #[common_macros::contract_impl]
        impl utils::auth::Auth for #name {
            fn authorizer(env: &soroban_sdk::Env) -> Option<soroban_sdk::Address> {
                <Self as utils::ownable::Ownable>::owner(env)
            }
        }

        #[common_macros::contract_impl(contracttrait)]
        impl utils::ownable::Ownable for #name {}
    }
}

// ============================================================================
// MultiSig Macro Implementation
// ============================================================================

/// Generates the multisig implementation from the `#[multisig]` attribute macro.
///
/// This macro implements both `Auth` and `MultiSig` traits for the contract:
/// - `Auth::authorizer()` returns the contract's own address (self-owning pattern)
/// - `MultiSig` provides signature verification and signer management
pub fn generate_multisig_impl(input: TokenStream) -> TokenStream {
    let item_struct: ItemStruct = syn::parse2(input).unwrap_or_else(|e| panic!("failed to parse struct: {}", e));
    let name = &item_struct.ident;

    quote! {
        #item_struct

        use utils::{auth::Auth as _, multisig::MultiSig as _};

        #[common_macros::contract_impl]
        impl utils::auth::Auth for #name {
            fn authorizer(env: &soroban_sdk::Env) -> Option<soroban_sdk::Address> {
                Some(env.current_contract_address())
            }
        }

        #[common_macros::contract_impl(contracttrait)]
        impl utils::multisig::MultiSig for #name {}
    }
}

// ============================================================================
// Only Auth Macro Implementation
// ============================================================================

/// Prepends an auth check to a method using the `Auth` trait.
///
/// Works with any contract that implements the `Auth` trait, including both
/// `Ownable` and `MultiSig` contracts.
pub fn prepend_only_auth_check(input: TokenStream) -> TokenStream {
    let mut input_fn: ItemFn = syn::parse2(input).unwrap_or_else(|e| panic!("failed to parse function: {}", e));

    let env_param = utils::expect_env_param(&input_fn.sig.inputs);

    // Get a reference to env (handles both `Env` and `&Env` parameter types)
    let env_ref = env_param.as_ref_tokens();

    // Insert the auth check at the beginning of the function body
    input_fn.block.stmts.insert(0, parse_quote!(utils::auth::require_auth::<Self>(#env_ref);));
    input_fn.into_token_stream()
}
