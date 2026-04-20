use proc_macro2::TokenStream;
use quote::quote;

use crate::tests::test_helpers::{assert_panics_contains, filter_item_inputs_excluding_labels};

// ============================================
// Snapshot Tests: lz_contract Code Generation
// ============================================

#[test]
fn snapshot_generated_lz_contract_code() {
    let input = quote! {
        pub struct MyContract;
    };

    let default_result = crate::lz_contract::generate_lz_contract(TokenStream::new(), input.clone());
    let default_formatted =
        prettyplease::unparse(&syn::parse2::<syn::File>(default_result).expect("failed to parse generated code"));

    let multisig_upgradeable_result = crate::lz_contract::generate_lz_contract(quote! { multisig, upgradeable }, input);
    let multisig_upgradeable_formatted = prettyplease::unparse(
        &syn::parse2::<syn::File>(multisig_upgradeable_result).expect("failed to parse generated code"),
    );

    let upgradeable_no_migration_result = crate::lz_contract::generate_lz_contract(
        quote! { upgradeable(no_migration) },
        quote! { pub struct MyContract; },
    );
    let upgradeable_no_migration_formatted = prettyplease::unparse(
        &syn::parse2::<syn::File>(upgradeable_no_migration_result).expect("failed to parse generated code"),
    );

    let upgradeable_rbac_result =
        crate::lz_contract::generate_lz_contract(quote! { upgradeable(rbac) }, quote! { pub struct MyContract; });
    let upgradeable_rbac_formatted = prettyplease::unparse(
        &syn::parse2::<syn::File>(upgradeable_rbac_result).expect("failed to parse generated code"),
    );

    // Pass-through: order and content preserved verbatim
    let upgradeable_rbac_no_migration_result = crate::lz_contract::generate_lz_contract(
        quote! { upgradeable(rbac, no_migration) },
        quote! { pub struct MyContract; },
    );
    let upgradeable_rbac_no_migration_formatted = prettyplease::unparse(
        &syn::parse2::<syn::File>(upgradeable_rbac_no_migration_result).expect("failed to parse generated code"),
    );

    let combined = format!(
        "// === Default (ownable) ===\n\n{}\n\n// === MultiSig + Upgradeable ===\n\n{}\n\n// === Upgradeable (no_migration) ===\n\n{}\n\n// === Upgradeable (rbac) ===\n\n{}\n\n// === Upgradeable (rbac, no_migration) pass-through ===\n\n{}",
        default_formatted, multisig_upgradeable_formatted, upgradeable_no_migration_formatted, upgradeable_rbac_formatted, upgradeable_rbac_no_migration_formatted
    );

    insta::assert_snapshot!(combined);
}

// ============================================
// Error Cases: Invalid Config
// ============================================

#[test]
fn test_lz_contract_invalid_config_table_driven() {
    let input = quote! { pub struct MyContract; };

    let cases: Vec<(&str, TokenStream, &str)> = vec![
        ("unknown option", quote! { not_a_real_option }, "expected one of `upgradeable`, `multisig`"),
        ("invalid attr syntax", quote! { 123 }, "failed to parse lz_contract config"),
    ];

    for (case, attr, expected_substring) in cases {
        assert_panics_contains(case, expected_substring, || {
            crate::lz_contract::generate_lz_contract(attr.clone(), input.clone());
        });
    }
}

// ============================================
// Error Cases: Non-Struct Input
// ============================================

#[test]
fn test_lz_contract_rejects_non_struct_inputs() {
    for (case, input) in filter_item_inputs_excluding_labels(&["struct"]) {
        assert_panics_contains(case, "failed to parse struct", || {
            crate::lz_contract::generate_lz_contract(TokenStream::new(), input.clone());
        });
    }
}
