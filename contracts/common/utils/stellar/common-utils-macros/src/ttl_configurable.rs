//! TtlConfigurable macro for Stellar smart contracts.

use proc_macro2::TokenStream;
use quote::quote;
use syn::ItemStruct;

/// Generates the `TtlConfigurable` trait implementation for a contract.
///
/// This macro implements `TtlConfigurable` using the trait's default methods (which include auth).
///
/// The contract must also implement `Auth` (typically via `#[ownable]` or `#[multisig]`).
pub fn generate_ttl_configurable_impl(input: TokenStream) -> TokenStream {
    let item_struct: ItemStruct = syn::parse2(input).unwrap_or_else(|e| panic!("failed to parse struct: {}", e));
    let name = &item_struct.ident;

    quote! {
        #item_struct

        use utils::ttl_configurable::TtlConfigurable as _;

        #[common_macros::contract_impl(contracttrait)]
        impl utils::ttl_configurable::TtlConfigurable for #name {}
    }
}
