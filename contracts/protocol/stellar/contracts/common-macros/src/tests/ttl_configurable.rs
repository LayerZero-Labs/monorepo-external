use quote::quote;

use crate::tests::test_helpers::{assert_panics_contains, filter_item_inputs_excluding_labels};

// ============================================
// Snapshot Test: TtlConfigurable Code Generation
// ============================================

#[test]
fn snapshot_generated_ttl_configurable_code() {
    // Test with a public unit struct
    let input = quote! {
        pub struct MyContract {
            some_field: u32,
        }
    };
    let result = crate::ttl_configurable::generate_ttl_configurable_impl(input);
    let formatted = prettyplease::unparse(&syn::parse2::<syn::File>(result).expect("failed to parse generated code"));

    insta::assert_snapshot!(formatted);
}

// ============================================
// Error Cases: Non-Struct Input
// ============================================

#[test]
fn test_ttl_configurable_rejects_non_struct_inputs() {
    for (case, input) in filter_item_inputs_excluding_labels(&["struct"]) {
        assert_panics_contains(case, "failed to parse struct", || {
            crate::ttl_configurable::generate_ttl_configurable_impl(input.clone());
        });
    }
}
