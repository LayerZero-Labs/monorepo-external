use proc_macro2::TokenStream;
use quote::quote;

use crate::tests::test_helpers::{assert_panics_contains, filter_item_inputs_excluding_labels};

static CARGO_PKG_VERSION_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Small RAII helper for temporarily mutating a single environment variable in tests.
///
/// Why this exists:
/// - `generate_upgradeable_impl` reads `CARGO_PKG_VERSION` at runtime to decide whether to emit
///   `soroban_sdk::contractmeta!(key = "binver", ...)`.
/// - Tests need to set/unset that env var deterministically and then restore it to avoid polluting
///   other tests (especially snapshot tests).
/// - `Drop` guarantees restoration even if the test panics.
struct EnvVarGuard {
    key: &'static str,
    prev: Option<String>,
}

impl EnvVarGuard {
    /// Captures the current value of `key` (if any) so it can be restored on drop.
    fn new(key: &'static str) -> Self {
        Self { key, prev: std::env::var(key).ok() }
    }

    /// Sets the environment variable for the duration of this guard's lifetime.
    fn set(&self, value: &str) {
        std::env::set_var(self.key, value);
    }

    /// Removes the environment variable for the duration of this guard's lifetime.
    fn remove(&self) {
        std::env::remove_var(self.key);
    }
}

impl Drop for EnvVarGuard {
    /// Restores the original env var state captured in `new()`.
    fn drop(&mut self) {
        match &self.prev {
            Some(v) => std::env::set_var(self.key, v),
            None => std::env::remove_var(self.key),
        }
    }
}

// ============================================
// Snapshot Test: Upgradeable Code Generation
// ============================================

#[test]
fn snapshot_generated_upgradeable_code() {
    let _lock = CARGO_PKG_VERSION_LOCK.lock().expect("lock poisoned");
    let input = quote! {
        pub struct MyContract;
    };

    // Test default behavior (requires manual UpgradeableInternal impl)
    let default_result = crate::upgradeable::generate_upgradeable_impl(TokenStream::new(), input.clone());
    let default_formatted =
        prettyplease::unparse(&syn::parse2::<syn::File>(default_result).expect("failed to parse generated code"));

    // Test with no_migration (auto-generates UpgradeableInternal impl)
    let no_migration_result = crate::upgradeable::generate_upgradeable_impl(quote! { no_migration }, input);
    let no_migration_formatted =
        prettyplease::unparse(&syn::parse2::<syn::File>(no_migration_result).expect("failed to parse generated code"));

    let combined = format!(
        "// ============================================\n\
         // Default: requires manual UpgradeableInternal\n\
         // ============================================\n\n\
         {default_formatted}\n\
         // ============================================\n\
         // With no_migration: auto-generates impl\n\
         // ============================================\n\n\
         {no_migration_formatted}"
    );

    insta::assert_snapshot!(combined);
}

// ============================================
// Error Cases: upgradeable macro non-struct input
// ============================================

#[test]
fn test_upgradeable_skips_binver_when_version_is_0_0_0() {
    let _lock = CARGO_PKG_VERSION_LOCK.lock().expect("lock poisoned");
    let guard = EnvVarGuard::new("CARGO_PKG_VERSION");
    guard.set("0.0.0");

    let input = quote! {
        pub struct MyContract;
    };
    let result = crate::upgradeable::generate_upgradeable_impl(TokenStream::new(), input);
    let result_str = result.to_string();

    assert!(
        !result_str.contains("contractmeta ! (key = \"binver\""),
        "should skip binver contractmeta when version is 0.0.0. Got: {}",
        result_str
    );
}

#[test]
fn test_upgradeable_skips_binver_when_version_is_missing() {
    let _lock = CARGO_PKG_VERSION_LOCK.lock().expect("lock poisoned");
    let guard = EnvVarGuard::new("CARGO_PKG_VERSION");
    guard.remove();

    let input = quote! {
        pub struct MyContract;
    };
    let result = crate::upgradeable::generate_upgradeable_impl(TokenStream::new(), input);
    let result_str = result.to_string();

    assert!(
        !result_str.contains("contractmeta ! (key = \"binver\""),
        "should skip binver contractmeta when version env is missing. Got: {}",
        result_str
    );
}

#[test]
fn test_upgradeable_rejects_non_struct_inputs() {
    let attr = TokenStream::new();
    for (case, input) in filter_item_inputs_excluding_labels(&["struct"]) {
        let attr_clone = attr.clone();
        assert_panics_contains(case, "failed to parse struct", || {
            crate::upgradeable::generate_upgradeable_impl(attr_clone, input.clone());
        });
    }
}

#[test]
fn test_upgradeable_emits_binver_when_version_is_set() {
    let _lock = CARGO_PKG_VERSION_LOCK.lock().expect("lock poisoned");
    let guard = EnvVarGuard::new("CARGO_PKG_VERSION");
    guard.set("9.9.9");

    let input = quote! {
        pub struct MyContract;
    };
    let result = crate::upgradeable::generate_upgradeable_impl(TokenStream::new(), input);
    let result_str = result.to_string();

    assert!(
        result_str.contains("contractmeta ! (key = \"binver\" , val = \"9.9.9\""),
        "should emit binver contractmeta when version is set. Got: {}",
        result_str
    );
}

#[test]
fn test_upgradeable_rejects_invalid_config_table_driven() {
    let input = quote! { pub struct MyContract; };
    let cases: Vec<(&str, TokenStream, &str)> = vec![
        ("unknown option", quote! { not_migration }, "failed to parse upgradeable config"),
        ("invalid attr syntax", quote! { 123 }, "failed to parse upgradeable config"),
        ("extra tokens", quote! { no_migration, extra }, "failed to parse upgradeable config"),
    ];

    for (case, attr, expected) in cases {
        assert_panics_contains(case, expected, || {
            crate::upgradeable::generate_upgradeable_impl(attr.clone(), input.clone());
        });
    }
}
