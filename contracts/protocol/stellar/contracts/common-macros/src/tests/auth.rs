use proc_macro2::TokenStream;
use quote::quote;

use crate::tests::test_helpers::{assert_panics_contains, filter_item_inputs_excluding_labels};

// ============================================
// Snapshot Test: Ownable Code Generation
// ============================================

#[test]
fn snapshot_generated_ownable_code() {
    let input = quote! {
        pub struct MyContract;
    };
    let result = crate::auth::generate_ownable_impl(input);
    let formatted = prettyplease::unparse(&syn::parse2::<syn::File>(result).expect("failed to parse generated code"));

    let input = quote! {
        #[derive(Clone, Debug)]
        pub struct MyContract<T>
        where
            T: Clone,
        {
            pub value: T,
        }
    };
    let result = crate::auth::generate_ownable_impl(input);
    let formatted_with_generics_and_fields =
        prettyplease::unparse(&syn::parse2::<syn::File>(result).expect("failed to parse generated code"));

    let combined = format!(
        "// === Unit struct ===\n\n{}\n\n// === Generics + fields ===\n\n{}",
        formatted, formatted_with_generics_and_fields
    );

    insta::assert_snapshot!(combined);
}

// ============================================
// Snapshot Test: MultiSig Code Generation
// ============================================

#[test]
fn snapshot_generated_multisig_code() {
    let input = quote! {
        pub struct MyContract;
    };
    let result = crate::auth::generate_multisig_impl(input);
    let formatted = prettyplease::unparse(&syn::parse2::<syn::File>(result).expect("failed to parse generated code"));

    let input = quote! {
        #[derive(Copy, Clone)]
        pub struct MyContract(pub u32);
    };
    let result = crate::auth::generate_multisig_impl(input);
    let formatted_with_tuple_struct =
        prettyplease::unparse(&syn::parse2::<syn::File>(result).expect("failed to parse generated code"));

    let combined = format!(
        "// === Unit struct ===\n\n{}\n\n// === Tuple struct ===\n\n{}",
        formatted, formatted_with_tuple_struct
    );

    insta::assert_snapshot!(combined);
}

// ============================================
// Snapshot Test: Only Auth Macro
// ============================================

#[test]
fn snapshot_only_auth_preserves_function_signature() {
    // Test with borrowed Env (&Env) - should use env directly
    let input_borrowed = quote! {
        pub(crate) async fn admin_action<T: Clone>(env: &Env, value: T) -> Result<T, Error> {
            Ok(value.clone())
        }
    };
    let result_borrowed = crate::auth::prepend_only_auth_check(input_borrowed);
    let formatted_borrowed =
        prettyplease::unparse(&syn::parse2::<syn::File>(result_borrowed).expect("failed to parse generated code"));

    // Test with owned Env - should produce &env reference in the generated code
    let input_owned = quote! {
        pub(crate) async fn admin_action<T: Clone>(env: Env, value: T) -> Result<T, Error> {
            Ok(value.clone())
        }
    };
    let result_owned = crate::auth::prepend_only_auth_check(input_owned);
    let formatted_owned =
        prettyplease::unparse(&syn::parse2::<syn::File>(result_owned).expect("failed to parse generated code"));

    // Combine all for single snapshot
    let combined = format!(
        "// === Borrowed Env (&Env) ===\n\n{}\n\n// === Owned Env (Env) ===\n\n{}",
        formatted_borrowed, formatted_owned
    );

    insta::assert_snapshot!(combined);
}

// ============================================
// prepend_only_auth_check Tests
// ============================================

/// Helper function to verify that the auth check is correctly inserted at the beginning of a function.
fn assert_auth_check_inserted(input: TokenStream, expected_env_ref: &str, test_name: &str) {
    let result_tokens = crate::auth::prepend_only_auth_check(input);
    let output_fn: syn::ItemFn =
        syn::parse2(result_tokens).unwrap_or_else(|e| panic!("{}: failed to parse output function: {}", test_name, e));

    assert!(!output_fn.block.stmts.is_empty(), "{}: function body should contain at least one statement", test_name);

    let first_stmt = &output_fn.block.stmts[0];
    let expected_stmt = format!("utils::auth::require_auth::<Self>({});", expected_env_ref);
    let actual_stmt = quote::quote!(#first_stmt).to_string().replace(" ", "");

    assert_eq!(
        actual_stmt, expected_stmt,
        "{}: expected auth check statement '{}', but got '{}'",
        test_name, expected_stmt, actual_stmt
    );
}

#[test]
fn test_only_auth_inserts_correct_code_at_the_beginning() {
    // (description, input, expected_env_ref)
    // Owned Env should produce &env, reference Env should produce env directly
    let test_cases = vec![
        ("Env by value", quote! { pub fn f(my_custom_env: Env) {} }, "&my_custom_env"),
        ("Env not first param (ref)", quote! { pub fn f(x: u32, my_custom_env: &Env) {} }, "my_custom_env"),
        ("Env after receiver", quote! { pub fn f(&self, my_custom_env: &Env) {} }, "my_custom_env"),
        ("Env after mut receiver", quote! { pub fn f(&mut self, my_custom_env: &Env) {} }, "my_custom_env"),
        ("Env after value receiver", quote! { pub fn f(self, my_custom_env: &Env) {} }, "my_custom_env"),
        ("Env after mut value receiver", quote! { pub fn f(mut self, my_custom_env: &Env) {} }, "my_custom_env"),
        ("Env with lifetime", quote! { pub fn f<'a>(my_custom_env: &'a Env) {} }, "my_custom_env"),
        ("Env with mut ref", quote! { pub fn f(my_custom_env: &mut Env) {} }, "my_custom_env"),
        ("Env with mut binding", quote! { pub fn f(mut my_custom_env: Env) {} }, "&my_custom_env"),
        ("Ref Env with mut binding", quote! { pub fn f(mut my_custom_env: &Env) {} }, "my_custom_env"),
        (
            "Qualified path (soroban_sdk::Env)",
            quote! { pub fn f(my_custom_env: soroban_sdk::Env) {} },
            "&my_custom_env",
        ),
        ("Reference to qualified path", quote! { pub fn f(my_custom_env: &soroban_sdk::Env) {} }, "my_custom_env"),
        (
            "Leading :: qualified path (::soroban_sdk::Env)",
            quote! { pub fn f(my_custom_env: ::soroban_sdk::Env) {} },
            "&my_custom_env",
        ),
        ("Leading :: ref qualified path", quote! { pub fn f(my_custom_env: &::soroban_sdk::Env) {} }, "my_custom_env"),
        (
            "Mut reference to qualified path",
            quote! { pub fn f(my_custom_env: &mut soroban_sdk::Env) {} },
            "my_custom_env",
        ),
        ("Nested reference (&&Env)", quote! { pub fn f(my_custom_env: &&Env) {} }, "my_custom_env"),
        ("Multiple Env params picks first", quote! { pub fn f(first_env: Env, second_env: Env) {} }, "&first_env"),
    ];

    for (description, input, expected_env_ref) in test_cases {
        assert_auth_check_inserted(input, expected_env_ref, description);
    }
}

#[test]
fn test_only_auth_requires_env_param() {
    // ============================================
    // Error Cases: Missing/Invalid Env Argument Patterns
    // ============================================
    let cases = vec![
        ("no Env param", quote! { pub fn admin_action(value: u32) {} }),
        // Tuple pattern destructuring is not supported - must use simple identifier
        ("tuple pattern", quote! { pub fn admin_action((env, _other): (&Env, u32)) {} }),
        // Wildcard pattern (_) is not supported - must use named identifier
        ("wildcard pattern", quote! { pub fn admin_action(_: &Env) {} }),
        // Struct destructuring pattern is not supported
        ("struct pattern", quote! { pub fn admin_action(Env { .. }: Env) {} }),
        // Non-Env wrapper/container types are not recognized as Env params.
        ("Option<Env>", quote! { pub fn admin_action(env: Option<Env>) {} }),
        ("Option<&Env>", quote! { pub fn admin_action(env: Option<&Env>) {} }),
        ("Vec<Env>", quote! { pub fn admin_action(env: Vec<Env>) {} }),
        ("Box<Env>", quote! { pub fn admin_action(env: Box<Env>) {} }),
    ];

    for (case, input) in cases {
        assert_panics_contains(case, "function must have an Env argument", || {
            crate::auth::prepend_only_auth_check(input.clone());
        });
    }
}

// ============================================
// Error Cases: only_auth macro non-function input
// ============================================

#[test]
fn test_only_auth_rejects_non_function_inputs() {
    for (case, input) in filter_item_inputs_excluding_labels(&["function"]) {
        assert_panics_contains(case, "failed to parse function", || {
            crate::auth::prepend_only_auth_check(input.clone());
        });
    }
}

// ============================================
// Error Cases: ownable macro non-struct input
// ============================================

#[test]
fn test_ownable_rejects_non_struct_inputs() {
    for (case, input) in filter_item_inputs_excluding_labels(&["struct"]) {
        assert_panics_contains(case, "failed to parse struct", || {
            crate::auth::generate_ownable_impl(input.clone());
        });
    }
}

// ============================================
// Error Cases: multisig macro non-struct input
// ============================================

#[test]
fn test_multisig_rejects_non_struct_inputs() {
    for (case, input) in filter_item_inputs_excluding_labels(&["struct"]) {
        assert_panics_contains(case, "failed to parse struct", || {
            crate::auth::generate_multisig_impl(input.clone());
        });
    }
}
