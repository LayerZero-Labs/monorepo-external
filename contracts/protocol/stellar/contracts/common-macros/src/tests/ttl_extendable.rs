use quote::quote;

use crate::tests::test_helpers::{assert_panics_contains, filter_item_inputs_excluding_labels};

// ============================================
// Snapshot Test: TtlExtendable Code Generation
// ============================================

#[test]
fn snapshot_generated_ttl_extendable_code() {
    let input = quote! {
        pub struct MyContract;
    };

    let result = crate::ttl_extendable::generate_ttl_extendable_impl(input);
    let formatted = prettyplease::unparse(&syn::parse2::<syn::File>(result).expect("failed to parse generated code"));

    insta::assert_snapshot!(formatted);
}

// ============================================
// Error Cases: Non-Struct Input
// ============================================

#[test]
fn test_ttl_extendable_rejects_non_struct_inputs() {
    for (case, input) in filter_item_inputs_excluding_labels(&["struct"]) {
        assert_panics_contains(case, "failed to parse struct", || {
            crate::ttl_extendable::generate_ttl_extendable_impl(input.clone());
        });
    }
}
