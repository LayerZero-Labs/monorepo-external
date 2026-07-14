use proc_macro2::TokenStream;
use quote::quote;

use crate::tests::test_helpers::{assert_panics_contains, filter_item_inputs_excluding_labels};

// ============================================================================
// Snapshot Tests
// ============================================================================

/// Comprehensive snapshot test for contractimpl_with_ttl macro:
/// - Inherent impl: public methods with Env (adds TTL), private/pub(crate) methods (skipped)
/// - Trait impl: all methods with Env get TTL extension
/// - Qualified Env types (soroban_sdk::Env)
/// - Env parameter not in first position
/// - Methods without Env (skipped)
#[test]
fn snapshot_generated_contractimpl_code() {
    // Test inherent impl with empty attr
    let empty_attr = TokenStream::new();
    let inherent_input = quote! {
        impl MyContract {
            // Non-fn items should be preserved by the macro
            const A_CONST: u32 = 1;
            type Alias = u32;

            /// Public method with Env - should have TTL extension
            pub fn public_with_env(env: Env, value: u32) -> u32 {
                value * 2
            }

            /// Public method with qualified Env path - should have TTL extension
            pub fn with_qualified_env(env: soroban_sdk::Env) -> u32 {
                42
            }

            /// Public method with Env not as first parameter - should have TTL extension
            pub fn env_second(value: u32, env: &Env) -> u32 {
                value * 2
            }

            /// Public method without Env - should NOT have TTL extension
            pub fn public_without_env(value: u32) -> u32 {
                value * 4
            }

            /// Private method with Env - should NOT have TTL extension (not public)
            fn private_with_env(env: Env, value: u32) -> u32 {
                value * 5
            }

            /// Pub(crate) method with Env - should NOT have TTL extension (not fully public)
            pub(crate) fn pub_crate_with_env(env: Env, value: u32) -> u32 {
                value * 7
            }

            /// Constructor method - should have init_default_ttl_configs
            pub fn __constructor(env: &Env, value: u32) {
                let _ = value * 2;
            }
        }
    };

    let inherent_result = crate::contract_ttl::contractimpl_with_ttl(empty_attr.clone(), inherent_input);
    let inherent_formatted =
        prettyplease::unparse(&syn::parse2::<syn::File>(inherent_result).expect("failed to parse generated code"));

    // Test trait impl with empty attr
    let trait_input = quote! {
        impl SomeTrait for MyContract {
            /// Trait method with Env - should have TTL extension
            fn trait_method_with_env(env: Env, value: u32) -> u32 {
                value * 2
            }

            /// Trait method without Env - should NOT have TTL extension
            fn trait_method_without_env(value: u32) -> u32 {
                value * 4
            }

            /// Trait method with macro attribute - should have TTL extension
            #[common_macros::only_auth]
            fn trait_method_with_only_auth_attribute(env: Env, value: u32) -> u32 {
                value * 5
            }
        }
    };

    let trait_result = crate::contract_ttl::contractimpl_with_ttl(empty_attr, trait_input);
    let trait_formatted =
        prettyplease::unparse(&syn::parse2::<syn::File>(trait_result).expect("failed to parse generated code"));

    // Test trait impl with contracttrait attr
    let contracttrait_attr = quote! { contracttrait };
    let contracttrait_input = quote! {
        impl AnotherTrait for MyContract {
            /// Trait method with contracttrait attr - should have TTL extension
            fn contracttrait_method(env: &Env, value: u32) -> u32 {
                value * 3
            }
        }
    };

    let contracttrait_result = crate::contract_ttl::contractimpl_with_ttl(contracttrait_attr, contracttrait_input);
    let contracttrait_formatted =
        prettyplease::unparse(&syn::parse2::<syn::File>(contracttrait_result).expect("failed to parse generated code"));

    // Combine all for single snapshot
    let combined = format!(
        "// === Inherent Impl (no attr) ===\n\n{}\n\n// === Trait Impl (no attr) ===\n\n{}\n\n// === Trait Impl (contracttrait attr) ===\n\n{}",
        inherent_formatted, trait_formatted, contracttrait_formatted
    );

    insta::assert_snapshot!(combined);
}

/// Comprehensive snapshot test for contracttrait_with_ttl macro:
/// - Default methods with Env (adds TTL)
/// - Abstract methods without body (skipped)
/// - Methods without Env (skipped)
/// - Qualified Env types (soroban_sdk::Env)
/// - Env parameter not in first position
#[test]
fn snapshot_generated_contracttrait_code() {
    // Test trait with empty attr
    let empty_attr = TokenStream::new();
    let trait_input = quote! {
        pub trait MyTrait: Sized {
            // Non-fn items should be preserved by the macro
            const A_CONST: u32;
            type Alias;

            /// Default method with Env - should have TTL extension
            fn default_with_env(env: Env, value: u32) -> u32 {
                value * 2
            }

            /// Default method with qualified Env path - should have TTL extension
            fn with_qualified_env(env: soroban_sdk::Env) -> u32 {
                42
            }

            /// Default method with Env not as first parameter - should have TTL extension
            fn env_second(value: u32, env: &Env) -> u32 {
                value * 2
            }

            /// Default method without Env - should NOT have TTL extension
            fn default_without_env(value: u32) -> u32 {
                value * 4
            }

            /// Abstract method with Env - should NOT have TTL extension (no body)
            fn abstract_with_env(env: Env, value: u32) -> u32;

            /// Abstract method without Env - should NOT have TTL extension (no body)
            fn abstract_without_env(value: u32) -> u32;
        }
    };

    let trait_result = crate::contract_ttl::contracttrait_with_ttl(empty_attr.clone(), trait_input);
    let trait_formatted =
        prettyplease::unparse(&syn::parse2::<syn::File>(trait_result).expect("failed to parse generated code"));

    // Test trait with crate attr
    let crate_attr = quote! { crate = "other_sdk" };
    let trait_with_attr_input = quote! {
        pub trait AnotherTrait {
            /// Default method with Env - should have TTL extension
            fn method_with_env(env: &Env, value: u32) -> u32 {
                value * 3
            }
        }
    };

    let trait_with_attr_result = crate::contract_ttl::contracttrait_with_ttl(crate_attr, trait_with_attr_input);
    let trait_with_attr_formatted = prettyplease::unparse(
        &syn::parse2::<syn::File>(trait_with_attr_result).expect("failed to parse generated code"),
    );

    // Combine all for single snapshot
    let combined = format!(
        "// === Trait (no attr) ===\n\n{}\n\n// === Trait (crate attr) ===\n\n{}",
        trait_formatted, trait_with_attr_formatted
    );

    insta::assert_snapshot!(combined);
}

// ============================================================================
// Error Cases: Invalid Input
// ============================================================================

#[test]
fn test_contractimpl_with_ttl_rejects_non_impl_block_input() {
    for (case, input) in filter_item_inputs_excluding_labels(&["impl block"]) {
        assert_panics_contains(case, "failed to parse impl block", || {
            crate::contract_ttl::contractimpl_with_ttl(TokenStream::new(), input.clone());
        });
    }
}

#[test]
fn test_contracttrait_with_ttl_rejects_non_trait_input() {
    for (case, input) in filter_item_inputs_excluding_labels(&["trait"]) {
        assert_panics_contains(case, "failed to parse trait definition", || {
            crate::contract_ttl::contracttrait_with_ttl(TokenStream::new(), input.clone());
        });
    }
}

// ============================================================================
// Unit Tests: Attribute Handling
// ============================================================================

#[test]
fn test_contractimpl_with_ttl_adds_contractimpl_attribute_table_driven() {
    // (name, attr, input, expected_substrings, forbidden_substrings)
    let cases: Vec<(&str, TokenStream, TokenStream, Vec<&str>, Vec<&str>)> = vec![
        (
            "empty attr",
            TokenStream::new(),
            quote! {
                impl MyContract {
                    pub fn my_method(env: Env) {}
                }
            },
            vec!["# [soroban_sdk :: contractimpl]"],
            // ensure we don't emit `#[...::contractimpl(...)]` when attr is empty
            vec!["contractimpl(", "contractimpl ("],
        ),
        (
            "with attr",
            quote! { contracttrait },
            quote! {
                impl SomeTrait for MyContract {
                    fn my_method(env: Env) {}
                }
            },
            vec!["contractimpl (contracttrait)"],
            vec![],
        ),
    ];

    for (name, attr, input, expected, forbidden) in cases {
        let result = crate::contract_ttl::contractimpl_with_ttl(attr, input);
        let result_str = result.to_string();
        for needle in expected {
            assert!(result_str.contains(needle), "{name}: expected '{needle}'. Got: {result_str}");
        }
        for needle in forbidden {
            assert!(!result_str.contains(needle), "{name}: should NOT contain '{needle}'. Got: {result_str}");
        }
    }
}

#[test]
fn test_contracttrait_with_ttl_adds_contracttrait_attribute_table_driven() {
    // (name, attr, input, expected_substrings, forbidden_substrings)
    let cases: Vec<(&str, TokenStream, TokenStream, Vec<&str>, Vec<&str>)> = vec![
        (
            "empty attr",
            TokenStream::new(),
            quote! {
                pub trait MyTrait {
                    fn my_method(env: Env) {}
                }
            },
            vec!["# [soroban_sdk :: contracttrait]"],
            // ensure we don't emit `#[...::contracttrait(...)]` when attr is empty
            vec!["contracttrait(", "contracttrait ("],
        ),
        (
            "with attr",
            quote! { crate = "my_crate" },
            quote! {
                pub trait MyTrait {
                    fn my_method(env: Env) {}
                }
            },
            vec!["contracttrait (crate = \"my_crate\")"],
            vec![],
        ),
    ];

    for (name, attr, input, expected, forbidden) in cases {
        let result = crate::contract_ttl::contracttrait_with_ttl(attr, input);
        let result_str = result.to_string();
        for needle in expected {
            assert!(result_str.contains(needle), "{name}: expected '{needle}'. Got: {result_str}");
        }
        for needle in forbidden {
            assert!(!result_str.contains(needle), "{name}: should NOT contain '{needle}'. Got: {result_str}");
        }
    }
}

// ============================================================================
// TTL Extension Test Infrastructure
// ============================================================================

/// Expected TTL extension behavior for a test case
#[derive(Clone)]
enum TtlExpectation {
    /// TTL extension should NOT be inserted
    None,
    /// TTL extension should be inserted with the given env argument
    /// - `env_arg`: pattern in `extend_instance_ttl(...)` (e.g., "& env" for owned, "env" for ref)
    Present { env_arg: &'static str },
}

/// Test runner for contractimpl_with_ttl TTL behavior
struct ImplTtlTestCase {
    name: &'static str,
    input: TokenStream,
    expectation: TtlExpectation,
}

impl ImplTtlTestCase {
    fn expect_ttl(name: &'static str, input: TokenStream, env_arg: &'static str) -> Self {
        Self { name, input, expectation: TtlExpectation::Present { env_arg } }
    }

    fn expect_no_ttl(name: &'static str, input: TokenStream) -> Self {
        Self { name, input, expectation: TtlExpectation::None }
    }

    fn run(&self) {
        let result = crate::contract_ttl::contractimpl_with_ttl(TokenStream::new(), self.input.clone());
        let result_str = result.to_string();
        assert_ttl_expectation(&self.expectation, &result_str, self.name);
    }
}

/// Test runner for contracttrait_with_ttl TTL behavior
struct TraitTtlTestCase {
    name: &'static str,
    input: TokenStream,
    expectation: TtlExpectation,
}

impl TraitTtlTestCase {
    fn expect_ttl(name: &'static str, input: TokenStream, env_arg: &'static str) -> Self {
        Self { name, input, expectation: TtlExpectation::Present { env_arg } }
    }

    fn expect_no_ttl(name: &'static str, input: TokenStream) -> Self {
        Self { name, input, expectation: TtlExpectation::None }
    }

    fn run(&self) {
        let result = crate::contract_ttl::contracttrait_with_ttl(TokenStream::new(), self.input.clone());
        let result_str = result.to_string();
        assert_ttl_expectation(&self.expectation, &result_str, self.name);
    }
}

fn assert_ttl_expectation(expectation: &TtlExpectation, result_str: &str, name: &str) {
    let has_ttl = result_str.contains("extend_instance_ttl");

    match expectation {
        TtlExpectation::None => {
            assert!(!has_ttl, "{}: TTL extension should NOT be present, but was found", name);
        }
        TtlExpectation::Present { env_arg } => {
            assert!(has_ttl, "{}: TTL extension should be present, but was not found", name);

            let extend_pattern = format!("extend_instance_ttl ({})", env_arg);
            assert!(
                result_str.contains(&extend_pattern),
                "{}: expected '{}' in extend_instance_ttl call. Got: {}",
                name,
                env_arg,
                result_str
            );
        }
    }
}

// ============================================================================
// TTL Extension Tests: contractimpl_with_ttl
// ============================================================================

#[test]
fn test_contractimpl_with_ttl_inserts_ttl_for_methods_with_env_table_driven() {
    // contractimpl_with_ttl: TTL should be inserted for methods with Env
    // - inherent impl: only `pub` methods are eligible
    // - trait impl: all methods are eligible
    //
    // (name, input, env_arg)
    let test_data = vec![
        (
            "public method with owned Env",
            quote! {
                impl MyContract {
                    pub fn my_method(env: Env) { let x = 1; }
                }
            },
            "& env",
        ),
        (
            "public method with ref Env",
            quote! {
                impl MyContract {
                    pub fn my_method(env: &Env) { let x = 1; }
                }
            },
            "env",
        ),
        (
            "public method with mut ref Env",
            quote! {
                impl MyContract {
                    pub fn my_method(env: &mut Env) { let x = 1; }
                }
            },
            "env",
        ),
        (
            "custom Env identifier (owned)",
            quote! {
                impl MyContract {
                    pub fn my_method(my_custom_env: Env) { let x = 1; }
                }
            },
            "& my_custom_env",
        ),
        (
            "custom Env identifier (ref)",
            quote! {
                impl MyContract {
                    pub fn my_method(my_custom_env: &Env) { let x = 1; }
                }
            },
            "my_custom_env",
        ),
        (
            "public method with receiver and Env",
            quote! {
                impl MyContract {
                    pub fn my_method(&self, env: &Env) { let x = 1; }
                }
            },
            "env",
        ),
        (
            "public method with mut Env binding (owned)",
            quote! {
                impl MyContract {
                    pub fn my_method(mut env: Env) { let x = 1; }
                }
            },
            "& env",
        ),
        (
            "public method with ::soroban_sdk::Env (owned)",
            quote! {
                impl MyContract {
                    pub fn my_method(env: ::soroban_sdk::Env) { let x = 1; }
                }
            },
            "& env",
        ),
        (
            "public method with &::soroban_sdk::Env (ref)",
            quote! {
                impl MyContract {
                    pub fn my_method(env: &::soroban_sdk::Env) { let x = 1; }
                }
            },
            "env",
        ),
        (
            "trait impl method with owned Env",
            quote! {
                impl SomeTrait for MyContract {
                    fn trait_method(env: Env) { let x = 1; }
                }
            },
            "& env",
        ),
        (
            "trait impl method with ref Env",
            quote! {
                impl SomeTrait for MyContract {
                    fn trait_method(env: &Env) { let x = 1; }
                }
            },
            "env",
        ),
    ];

    for (name, input, env_arg) in test_data {
        ImplTtlTestCase::expect_ttl(name, input, env_arg).run();
    }
}

#[test]
fn test_contractimpl_with_ttl_skips_ttl_insertion_table_driven() {
    // (name, input)
    let cases = vec![
        (
            "private method with Env",
            quote! {
                impl MyContract {
                    fn private_method(env: Env) { let x = 1; }
                }
            },
        ),
        (
            "public method without Env",
            quote! {
                impl MyContract {
                    pub fn no_env_method(value: u32) -> u32 { value }
                }
            },
        ),
        (
            "public method with wildcard Env binding (unsupported pattern)",
            quote! {
                impl MyContract {
                    pub fn my_method(_: Env) { let x = 1; }
                }
            },
        ),
        (
            "pub(super) method with Env (not fully public)",
            quote! {
                impl MyContract {
                    pub(super) fn my_method(env: Env) { let x = 1; }
                }
            },
        ),
        (
            "pub(in ...) method with Env (not fully public)",
            quote! {
                impl MyContract {
                    pub(in crate::some_module) fn my_method(env: Env) { let x = 1; }
                }
            },
        ),
    ];

    for (name, input) in cases {
        ImplTtlTestCase::expect_no_ttl(name, input).run();
    }
}

// ============================================================================
// TTL Extension Tests: contracttrait_with_ttl
// ============================================================================

#[test]
fn test_contracttrait_with_ttl_inserts_ttl_for_default_methods_with_env_table_driven() {
    // (name, input, env_arg)
    let test_data = vec![
        (
            "default method with owned Env",
            quote! {
                trait MyTrait {
                    fn my_method(env: Env) { let x = 1; }
                }
            },
            "& env",
        ),
        (
            "default method with ref Env",
            quote! {
                trait MyTrait {
                    fn my_method(env: &Env) { let x = 1; }
                }
            },
            "env",
        ),
        (
            "default method with mut ref Env",
            quote! {
                trait MyTrait {
                    fn my_method(env: &mut Env) { let x = 1; }
                }
            },
            "env",
        ),
        (
            "custom Env identifier (owned)",
            quote! {
                trait MyTrait {
                    fn my_method(my_custom_env: Env) { let x = 1; }
                }
            },
            "& my_custom_env",
        ),
        (
            "custom Env identifier (ref)",
            quote! {
                trait MyTrait {
                    fn my_method(my_custom_env: &Env) { let x = 1; }
                }
            },
            "my_custom_env",
        ),
        (
            "default method with receiver and Env",
            quote! {
                trait MyTrait {
                    fn my_method(&self, env: &Env) { let x = 1; }
                }
            },
            "env",
        ),
    ];

    for (name, input, env_arg) in test_data {
        TraitTtlTestCase::expect_ttl(name, input, env_arg).run();
    }
}

// ============================================================================
// Constructor behavior: contractimpl_with_ttl
// ============================================================================

#[test]
fn test_contractimpl_with_ttl_injects_init_default_ttl_configs_only_in_constructor() {
    // `__constructor` should get default TTL config init, and should NOT get TTL extension.
    let cases: Vec<(&str, TokenStream, Vec<&str>, Vec<&str>)> = vec![
        (
            "constructor with owned Env",
            quote! {
                impl MyContract {
                    pub fn __constructor(env: Env) { let x = 1; }
                }
            },
            // expects init call and correct arg form (`&env` because Env is owned)
            vec!["ttl_configurable :: init_default_ttl_configs (& env)"],
            // should not insert TTL extension
            vec!["TtlConfigStorage :: instance", "extend_ttl"],
        ),
        (
            "constructor with ref Env",
            quote! {
                impl MyContract {
                    pub fn __constructor(env: &Env) { let x = 1; }
                }
            },
            // expects init call and correct arg form (`env` because Env is already a ref)
            vec!["ttl_configurable :: init_default_ttl_configs (env)"],
            vec!["TtlConfigStorage :: instance", "extend_ttl"],
        ),
    ];

    for (name, input, expected, forbidden) in cases {
        let result = crate::contract_ttl::contractimpl_with_ttl(TokenStream::new(), input);
        let result_str = result.to_string();
        for needle in expected {
            assert!(result_str.contains(needle), "{name}: expected '{needle}'. Got: {result_str}");
        }
        for needle in forbidden {
            assert!(!result_str.contains(needle), "{name}: should NOT contain '{needle}'. Got: {result_str}");
        }
    }
}

#[test]
fn test_contracttrait_with_ttl_skips_ttl_insertion_table_driven() {
    // (name, input)
    let cases = vec![
        (
            "abstract method with Env (no body)",
            quote! {
                trait MyTrait {
                    fn abstract_method(env: Env) -> u32;
                }
            },
        ),
        (
            "default method without Env",
            quote! {
                trait MyTrait {
                    fn no_env_method(value: u32) -> u32 { value }
                }
            },
        ),
        (
            "default method with wildcard Env binding (unsupported pattern)",
            quote! {
                trait MyTrait {
                    fn my_method(_: Env) { let x = 1; }
                }
            },
        ),
    ];

    for (name, input) in cases {
        TraitTtlTestCase::expect_no_ttl(name, input).run();
    }
}
