//! Unit tests for the `gen_params` function.

use crate::storage::test::gen_params_for_test;
use quote::quote;

use super::test_setup::{normalize, parse_variant};

#[test]
fn test_unit_variant_only_env_param() {
    let variant = parse_variant(quote! {
        enum Test {
            #[persistent(u32)]
            UnitVariant,
        }
    });

    let params = gen_params_for_test(&variant);
    let expected = quote! { env: &soroban_sdk::Env };
    assert_eq!(normalize(params), normalize(expected));
}

#[test]
fn test_named_variant_with_primitive_field_by_value() {
    let variant = parse_variant(quote! {
        enum Test {
            #[persistent(u32)]
            NamedVariant { key: u32 },
        }
    });

    let params = gen_params_for_test(&variant);
    let expected = quote! { env: &soroban_sdk::Env, key: u32 };
    assert_eq!(normalize(params), normalize(expected));
}

#[test]
fn test_named_variant_with_non_primitive_field_by_reference() {
    let variant = parse_variant(quote! {
        enum Test {
            #[persistent(u32)]
            NamedVariant { key: Address },
        }
    });

    let params = gen_params_for_test(&variant);
    let expected = quote! { env: &soroban_sdk::Env, key: &Address };
    assert_eq!(normalize(params), normalize(expected));
}

#[test]
fn test_named_variant_mixed_primitive_and_non_primitive() {
    let variant = parse_variant(quote! {
        enum Test {
            #[persistent(u32)]
            MixedVariant { id: u64, name: String, count: i128, address: Address },
        }
    });

    let params = gen_params_for_test(&variant);
    // u64 and i128 are primitives (by value), String and Address are not (by reference)
    let expected = quote! { env: &soroban_sdk::Env, id: u64, name: &String, count: i128, address: &Address };
    assert_eq!(normalize(params), normalize(expected));
}

#[test]
fn test_all_primitive_types_by_value() {
    let primitives = [
        ("u32", "u32"),
        ("i32", "i32"),
        ("u64", "u64"),
        ("i64", "i64"),
        ("u128", "u128"),
        ("i128", "i128"),
        ("bool", "bool"),
    ];

    for (ty_str, expected_ty) in primitives {
        let input = format!(
            r#"
            enum Test {{
                #[persistent(u32)]
                Variant {{ key: {} }},
            }}
            "#,
            ty_str
        );
        let variant = parse_variant(input.parse().unwrap());
        let params = gen_params_for_test(&variant);
        let params_str = params.to_string();

        // Should be by value (no &)
        assert!(
            params_str.contains(&format!("key : {}", expected_ty)),
            "primitive type {} should be passed by value, got: {}",
            ty_str,
            params_str
        );
        assert!(
            !params_str.contains(&format!("key : & {}", expected_ty)),
            "primitive type {} should NOT be passed by reference, got: {}",
            ty_str,
            params_str
        );
    }
}
