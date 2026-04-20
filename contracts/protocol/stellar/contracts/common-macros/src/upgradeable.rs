//! Upgradeable macro for Stellar smart contracts.

use proc_macro2::TokenStream;
use quote::quote;
use syn::{
    parse::{Parse, ParseStream},
    Ident, ItemStruct, Token,
};

/// Configuration options for the `#[upgradeable]` macro.
#[derive(Debug, Default)]
pub struct UpgradeableConfig {
    /// If true, generates a default no-op `UpgradeableInternal` implementation.
    /// Use this for initial deployments when no migration logic is needed yet.
    pub no_migration: bool,
    /// If true, uses `UpgradeableRbac` (Auth + RoleBased) instead of `Upgradeable` (Auth only).
    pub rbac: bool,
}

impl Parse for UpgradeableConfig {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let mut config = Self::default();
        if input.is_empty() {
            return Ok(config);
        }

        while !input.is_empty() {
            let ident: Ident = input.parse()?;
            match ident.to_string().as_str() {
                "no_migration" => config.no_migration = true,
                "rbac" => config.rbac = true,
                _ => return Err(syn::Error::new(ident.span(), "expected `no_migration` or `rbac`")),
            }

            // Consume optional trailing comma
            if input.peek(Token![,]) {
                input.parse::<Token![,]>()?;
            }
        }
        Ok(config)
    }
}

/// Generates the upgradeable implementation from the `#[upgradeable]` attribute macro.
///
/// Generates an impl of `Upgradeable` or `UpgradeableRbac` for a contract type,
/// enabling upgrades by replacing WASM bytecode with migration support.
///
/// # Behavior
///
/// - By default implements `Upgradeable` (Auth-based, `#[only_auth]`). With `rbac`,
///   implements `UpgradeableRbac` (Auth + RoleBased, `UPGRADER_ROLE`).
/// - Sets the contract crate version as `"binver"` metadata using
///   `soroban_sdk::contractmeta!`. Uses `CARGO_PKG_VERSION` (from Cargo.toml
///   `[package]` version). Skips if missing or `"0.0.0"`.
/// - By default, requires the contract to implement `UpgradeableInternal`.
/// - With `no_migration`, generates a no-op `UpgradeableInternal` impl.
/// - With `rbac`, uses `UpgradeableRbac` (requires `RoleBasedAccessControl`, which
///   extends `Auth`) instead of `Upgradeable` (requires `Auth`).
///
/// See the `#[upgradeable]` macro documentation for full examples.
pub fn generate_upgradeable_impl(attr: TokenStream, input: TokenStream) -> TokenStream {
    let config: UpgradeableConfig =
        syn::parse2(attr).unwrap_or_else(|e| panic!("failed to parse upgradeable config: {}", e));
    let item_struct: ItemStruct = syn::parse2(input).unwrap_or_else(|e| panic!("failed to parse struct: {}", e));

    let name = &item_struct.ident;
    let binver = set_binver_from_env();

    // Generate default UpgradeableInternal impl only when no_migration is set
    let default_internal_impl = if config.no_migration {
        quote! {
            impl utils::upgradeable::UpgradeableInternal for #name {
                type MigrationData = ();
                fn __migrate(_env: &soroban_sdk::Env, _migration_data: &Self::MigrationData) {}
            }
        }
    } else {
        quote! {}
    };

    let trait_path = if config.rbac {
        quote! { utils::upgradeable::UpgradeableRbac }
    } else {
        quote! { utils::upgradeable::Upgradeable }
    };

    quote! {
        #item_struct

        use #trait_path as _;

        #binver

        #default_internal_impl

        #[common_macros::contract_impl(contracttrait)]
        impl #trait_path for #name {}
    }
}

/// Sets the value of the environment variable `CARGO_PKG_VERSION` as `binver`
/// in the wasm binary metadata. This env variable corresponds to the attribute
/// "version" in Cargo.toml. If the attribute is missing or if it is "0.0.0",
/// the function does nothing.
fn set_binver_from_env() -> TokenStream {
    // However when "version" is missing from Cargo.toml,
    // the following does not return error, but Ok("0.0.0")
    let version = std::env::var("CARGO_PKG_VERSION");

    match version {
        Ok(v) if v != "0.0.0" => {
            quote! { soroban_sdk::contractmeta!(key = "binver", val = #v); }
        }
        _ => quote! {},
    }
}

#[cfg(test)]
mod tests {
    use std::env;

    use super::*;

    #[test]
    fn test_set_binver_from_env_zero_version() {
        // Set version to 0.0.0
        env::set_var("CARGO_PKG_VERSION", "0.0.0");

        let result = set_binver_from_env();
        let result_str = result.to_string();

        // Should return empty tokens
        assert_eq!(result_str.trim(), "");
    }
}
