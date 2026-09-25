//! Code generators for OApp trait implementations.

use proc_macro2::TokenStream;
use quote::quote;
use syn::{
    bracketed,
    parse::{Parse, ParseStream},
    punctuated::Punctuated,
    Error, Ident, ItemStruct, Token,
};

/// Specifies which OApp trait implementations the user will provide themselves.
///
/// Parsed from `#[oapp(custom = [...])]`. When a field is `true`, the macro skips
/// generating that trait implementation, allowing the user to provide their own.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct CustomImpls {
    pub core: bool,
    pub sender: bool,
    pub receiver: bool,
    pub options_type3: bool,
}

impl Parse for CustomImpls {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        if input.is_empty() {
            return Ok(Self::default());
        }

        // Consume the `custom` keyword
        let key: Ident = input.parse()?;
        if key != "custom" {
            return Err(Error::new(key.span(), "expected `custom`"));
        }

        // Consume the `=` in `custom = [...]`
        input.parse::<Token![=]>()?;

        // Parse the `[...]` brackets and capture the inner tokens into `content`
        let content;
        bracketed!(content in input);

        // Parse the comma-separated list of identifiers into `idents`
        let idents = Punctuated::<Ident, Token![,]>::parse_terminated(&content)?;

        // Initialize the custom implementations struct
        let mut custom_impls = Self::default();

        for ident in idents {
            match ident.to_string().as_str() {
                "core" => custom_impls.core = true,
                "sender" => custom_impls.sender = true,
                "receiver" => custom_impls.receiver = true,
                "options_type3" => custom_impls.options_type3 = true,
                _ => {
                    return Err(Error::new(
                        ident.span(),
                        "expected one of `core`, `sender`, `receiver`, `options_type3`",
                    ));
                }
            }
        }

        Ok(custom_impls)
    }
}

/// Generates OApp trait implementations only. No contract-level attributes are applied.
///
/// This function creates OAppCore, OAppSenderInternal, OAppReceiver, and OAppOptionsType3 trait implementations.
///
/// **The user must apply a contract macro** such as `#[common_macros::lz_contract]` or
/// `#[soroban_sdk::contract]` to the struct. `#[lz_contract]` provides contract, TTL, and Auth
/// (via `#[ownable]` or `#[multisig]`) in one place.
///
/// The `custom` parameter controls which trait implementations are generated vs.
/// expected to be provided by the user.
pub fn generate_oapp(attr: TokenStream, input: TokenStream) -> TokenStream {
    let custom: CustomImpls = syn::parse2(attr).unwrap_or_else(|e| panic!("failed to parse oapp attributes: {}", e));
    let item_struct: ItemStruct = syn::parse2(input).unwrap_or_else(|e| panic!("failed to parse struct: {}", e));

    let core_impl = (!custom.core).then(|| generate_oapp_core(&item_struct.ident));
    let sender_impl = (!custom.sender).then(|| generate_oapp_sender(&item_struct.ident));
    let receiver_impl = (!custom.receiver).then(|| generate_oapp_receiver(&item_struct.ident));
    let options_type3_impl = (!custom.options_type3).then(|| generate_oapp_options_type3(&item_struct.ident));
    quote! {
        #item_struct

        #core_impl
        #sender_impl
        #receiver_impl
        #options_type3_impl
    }
}

/// Generates an empty `impl OAppCore` that uses the trait's default implementations
/// for peer management and endpoint access.
///
/// Also generates `impl RoleBasedAccessControl` because OAppCore extends it.
fn generate_oapp_core(name: &Ident) -> TokenStream {
    quote! {
        use oapp::oapp_core::OAppCore as _;
        use utils::rbac::RoleBasedAccessControl as _;

        #[soroban_sdk::contractimpl(contracttrait)]
        impl oapp::oapp_core::OAppCore for #name {}

        #[soroban_sdk::contractimpl(contracttrait)]
        impl utils::rbac::RoleBasedAccessControl for #name {}
    }
}

/// Generates the `OAppSenderInternal` trait implementation.
///
/// Generates an empty `impl OAppSenderInternal` that uses the trait's default
/// implementations for `__lz_quote` and `__lz_send`.
fn generate_oapp_sender(name: &Ident) -> TokenStream {
    quote! {
        use oapp::oapp_sender::OAppSenderInternal as _;

        impl oapp::oapp_sender::OAppSenderInternal for #name {}
    }
}

/// Generates an empty `impl OAppReceiver` that uses the trait's default `lz_receive`
/// implementation (which calls `clear_payload_and_transfer` then `__lz_receive`).
///
/// Users must implement `LzReceiveInternal` themselves to provide the `__lz_receive` method.
fn generate_oapp_receiver(name: &Ident) -> TokenStream {
    quote! {
        use oapp::oapp_receiver::OAppReceiver as _;

        #[soroban_sdk::contractimpl(contracttrait)]
        impl oapp::oapp_receiver::OAppReceiver for #name {}
    }
}

/// Generates an empty `impl OAppOptionsType3` that uses the trait's default
/// implementations for enforced options management.
fn generate_oapp_options_type3(name: &Ident) -> TokenStream {
    quote! {
        use oapp::oapp_options_type3::OAppOptionsType3 as _;

        #[soroban_sdk::contractimpl(contracttrait)]
        impl oapp::oapp_options_type3::OAppOptionsType3 for #name {}
    }
}
