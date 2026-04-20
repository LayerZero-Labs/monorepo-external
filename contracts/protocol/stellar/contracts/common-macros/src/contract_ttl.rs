use crate::utils;
use proc_macro2::TokenStream;
use quote::quote;
use syn::{ImplItem, ItemImpl, ItemTrait, TraitItem, Visibility};

/// Generates a `#[soroban_sdk::contractimpl]` with automatic instance TTL extension.
///
/// - For `__constructor` methods: injects `ttl_configurable::init_default_ttl_configs(env)`
/// - For other methods: injects TTL extension logic to extend instance TTL if configured
pub fn contractimpl_with_ttl(attr: TokenStream, input: TokenStream) -> TokenStream {
    let mut impl_block: ItemImpl = syn::parse2(input).unwrap_or_else(|e| panic!("failed to parse impl block: {}", e));

    let is_trait_impl = impl_block.trait_.is_some();

    for item in &mut impl_block.items {
        let ImplItem::Fn(method) = item else { continue };

        // For trait impls, process all methods; for inherent impls, only public methods
        if !is_trait_impl && !matches!(method.vis, Visibility::Public(_)) {
            continue;
        }

        // Skip methods without Env parameter
        let Some(env_param) = utils::find_env_param(&method.sig.inputs) else { continue };

        if method.sig.ident == "__constructor" {
            // Inject default TTL config initialization in constructor
            method.block.stmts.insert(0, init_default_ttl_configs_stmt(&env_param));
        } else {
            // Inject TTL extension at the start of other methods
            method.block.stmts.insert(0, extend_instance_ttl_stmt(&env_param));
        }
    }

    let contract_attr = if attr.is_empty() {
        quote! { #[soroban_sdk::contractimpl]}
    } else {
        quote! { #[soroban_sdk::contractimpl(#attr)] }
    };
    quote! {
        #contract_attr
        #impl_block
    }
}

/// Generates a `#[soroban_sdk::contracttrait]` with automatic instance TTL extension.
///
/// This macro processes trait definitions and injects TTL extension logic into
/// default method implementations that have an `Env` parameter.
pub fn contracttrait_with_ttl(attr: TokenStream, input: TokenStream) -> TokenStream {
    let mut trait_def: ItemTrait =
        syn::parse2(input).unwrap_or_else(|e| panic!("failed to parse trait definition: {}", e));

    for item in &mut trait_def.items {
        let TraitItem::Fn(method) = item else { continue };

        // Only process methods with default implementations (have a body)
        let Some(ref mut block) = method.default else { continue };

        // Skip methods without Env parameter
        let Some(env_param) = utils::find_env_param(&method.sig.inputs) else { continue };

        // Inject TTL extension at the start of the method body
        block.stmts.insert(0, extend_instance_ttl_stmt(&env_param));
    }

    let trait_attr = if attr.is_empty() {
        quote! { #[soroban_sdk::contracttrait]}
    } else {
        quote! { #[soroban_sdk::contracttrait(#attr)] }
    };
    quote! {
        #trait_attr
        #trait_def
    }
}

/// Generates a statement that initializes default TTL configs in the constructor.
fn init_default_ttl_configs_stmt(env_param: &utils::EnvParam<'_>) -> syn::Stmt {
    let env_ref = env_param.as_ref_tokens();
    syn::parse_quote! {
        utils::ttl_configurable::init_default_ttl_configs(#env_ref);
    }
}

/// Generates a statement that extends instance TTL if configured.
fn extend_instance_ttl_stmt(env_param: &utils::EnvParam<'_>) -> syn::Stmt {
    let env_ref = env_param.as_ref_tokens();
    syn::parse_quote! {
        utils::ttl_configurable::extend_instance_ttl(#env_ref);
    }
}
