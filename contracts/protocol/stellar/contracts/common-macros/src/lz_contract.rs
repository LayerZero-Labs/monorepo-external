//! LzContract wrapper macro for Stellar smart contracts.
//!
//! This module provides the `#[lz_contract]` macro which combines commonly used
//! LayerZero contract attributes into a single macro invocation.

use proc_macro2::TokenStream;
use quote::quote;
use syn::{
    parenthesized,
    parse::{Parse, ParseStream},
    Error, Ident, ItemStruct, Token,
};

/// Configuration options for the `#[lz_contract]` macro.
#[derive(Debug, Default)]
pub struct LzContractConfig {
    /// If true, adds `#[upgradeable]` for contract upgrade support.
    pub upgradeable: bool,
    /// Raw tokens inside `upgradeable(...)`, passed verbatim to the upgradeable macro.
    /// Empty when `upgradeable` has no parentheses.
    pub upgradeable_attr: TokenStream,
    /// If true, uses `#[multisig]` instead of `#[ownable]` for auth.
    pub multisig: bool,
}

impl Parse for LzContractConfig {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let mut config = Self::default();
        if input.is_empty() {
            return Ok(config);
        }

        // Parse comma-separated items, handling nested parentheses for upgradeable(no_migration)
        while !input.is_empty() {
            let ident: Ident = input.parse()?;

            match ident.to_string().as_str() {
                "upgradeable" => {
                    config.upgradeable = true;
                    // Pass through optional (...) content verbatim to the upgradeable macro
                    if input.peek(syn::token::Paren) {
                        let content;
                        parenthesized!(content in input);
                        config.upgradeable_attr = content.parse()?;
                    }
                }
                "multisig" => config.multisig = true,
                _ => {
                    return Err(Error::new(ident.span(), "expected one of `upgradeable`, `multisig`"));
                }
            }

            // Consume optional trailing comma
            if input.peek(Token![,]) {
                let _: Token![,] = input.parse()?;
            }
        }

        Ok(config)
    }
}

/// Generates a complete LayerZero contract with common macro attributes.
///
/// # Default (no options)
/// Generates:
/// - `#[soroban_sdk::contract]` - Soroban contract
/// - `#[common_macros::ttl_configurable]` - TTL configuration with auth
/// - `#[common_macros::ttl_extendable]` - Manual TTL extension
/// - `#[common_macros::ownable]` - Single-owner access control
///
/// # Options
/// - `upgradeable(...)` - Adds `#[upgradeable(...)]`; content is passed verbatim to the upgradeable macro
/// - `multisig` - Uses `#[multisig]` instead of `#[ownable]`
pub fn generate_lz_contract(attr: TokenStream, input: TokenStream) -> TokenStream {
    let config: LzContractConfig =
        syn::parse2(attr).unwrap_or_else(|e| panic!("failed to parse lz_contract config: {}", e));
    let item: ItemStruct = syn::parse2(input).unwrap_or_else(|e| panic!("failed to parse struct: {}", e));

    let auth = if config.multisig {
        quote! { #[common_macros::multisig] }
    } else {
        quote! { #[common_macros::ownable] }
    };

    let upgrade = if config.upgradeable {
        if config.upgradeable_attr.is_empty() {
            quote! { #[common_macros::upgradeable] }
        } else {
            let upgradeable_attr = &config.upgradeable_attr;
            quote! { #[common_macros::upgradeable(#upgradeable_attr)] }
        }
    } else {
        quote! {}
    };

    quote! {
        #[soroban_sdk::contract]
        #[common_macros::ttl_configurable]
        #[common_macros::ttl_extendable]
        #auth
        #upgrade
        #item
    }
}
