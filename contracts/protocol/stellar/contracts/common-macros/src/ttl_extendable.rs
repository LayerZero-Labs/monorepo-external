//! TtlExtendable macro for Stellar smart contracts.

use proc_macro2::TokenStream;
use quote::quote;
use syn::ItemStruct;

/// Generates the TtlExtendable trait implementation from the `#[ttl_extendable]` attribute macro.
///
/// This macro implements the `TtlExtendable` trait for a contract struct,
/// providing a public `extend_instance_ttl` function for manual TTL extension.
///
/// Uses `soroban_sdk::contractimpl` directly instead of `common_macros::contract_impl`
/// because `contract_impl` automatically extends TTL on every invocation. Since this
/// impl block provides manual TTL extension control, auto-extension would be redundant
/// and could mask the intended behavior of `extend_instance_ttl`.
pub fn generate_ttl_extendable_impl(input: TokenStream) -> TokenStream {
    let item_struct: ItemStruct = syn::parse2(input).unwrap_or_else(|e| panic!("failed to parse struct: {}", e));
    let name = &item_struct.ident;

    quote! {
        #item_struct

        use utils::ttl_extendable::TtlExtendable as _;

        #[soroban_sdk::contractimpl(contracttrait)]
        impl utils::ttl_extendable::TtlExtendable for #name {}
    }
}
