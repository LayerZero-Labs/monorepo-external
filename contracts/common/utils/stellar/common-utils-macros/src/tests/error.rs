use quote::quote;

use crate::tests::test_helpers::{assert_panics_contains, filter_item_inputs_excluding_labels};

// ============================================
// Error Cases: Invalid Inputs
// ============================================

#[test]
fn test_contract_error_rejects_non_enum_inputs() {
    for (case, input) in filter_item_inputs_excluding_labels(&["enum"]) {
        assert_panics_contains(case, "failed to parse enum", || {
            crate::error::generate_error(input.clone());
        });
    }
}

#[test]
fn test_contract_error_requires_unit_variants() {
    let cases = vec![("tuple variant", quote! { A(u32) }), ("struct variant", quote! { A { x: u32 } })];

    for (case, variant) in cases {
        let input = quote! {
            pub enum MyError {
                #variant,
            }
        };
        assert_panics_contains(case, "Error enum variants must be unit variants", || {
            crate::error::generate_error(input.clone());
        });
    }
}

#[test]
fn test_contract_error_discriminant_must_be_integer_literal() {
    let cases = vec![
        ("binary expr", quote! { 1 + 1 }),
        ("path expr", quote! { SOME_CONST }),
        ("negative integer (unary expr)", quote! { -1 }),
        ("paren expr", quote! { (1) }),
        ("bool literal", quote! { true }),
        ("string literal", quote! { "1" }),
        ("float literal", quote! { 1.0 }),
        ("char literal", quote! { 'a' }),
    ];

    for (case, expr) in cases {
        let input = quote! {
            pub enum MyError {
                A = #expr,
            }
        };
        assert_panics_contains(case, "Error enum discriminant must be an integer literal", || {
            crate::error::generate_error(input.clone());
        });
    }
}

#[test]
fn test_contract_error_discriminant_must_fit_u32() {
    let input = quote! {
        pub enum MyError {
            A = 4294967296,
        }
    };

    assert_panics_contains("u32::MAX + 1", "Error enum discriminant must be a valid u32 integer", || {
        crate::error::generate_error(input);
    });
}

#[test]
fn test_contract_error_discriminants_ordering_rejections_table_driven() {
    let cases = vec![
        (
            "explicit value is less than previous",
            quote! {
                // A is assigned 1 by default; B cannot go backwards.
                A,
                B = 1,
            },
        ),
        (
            "explicit zero",
            quote! {
                A = 0,
            },
        ),
        (
            "explicit equal to previous explicit",
            quote! {
                A = 1,
                B = 1,
            },
        ),
        (
            "explicit decreases after explicit",
            quote! {
                A = 5,
                B = 4,
            },
        ),
    ];

    for (case, variants) in cases {
        let input = quote! {
            pub enum MyError {
                #variants
            }
        };
        assert_panics_contains(case, "Error enum discriminant must be greater than the previous discriminant", || {
            crate::error::generate_error(input.clone());
        });
    }
}

#[test]
fn test_contract_error_max_not_last_panics_overflow() {
    let input = quote! {
        pub enum MyError {
            A = 4294967295,
            B,
        }
    };
    assert_panics_contains("max not last overflows", "attempt to add with overflow", || {
        crate::error::generate_error(input);
    });
}

// ============================================
// Valid Cases: Snapshot Tests for Generated Code
// ============================================

#[test]
fn snapshot_generated_contract_error_code() {
    let input = quote! {
        /// Example error enum
        pub enum MyError {
            /// Implicit (should start at 1)
            A,
            /// Implicit (should be 2)
            B,
            /// Explicit (must be >= previous + 1)
            C = 10,
            /// Implicit (should be 11)
            D,
            /// Explicit max boundary (u32::MAX)
            E = 4294967295,
        }
    };

    let result = crate::error::generate_error(input);
    let formatted = prettyplease::unparse(&syn::parse2::<syn::File>(result).expect("failed to parse generated code"));

    insta::assert_snapshot!(formatted);
}
