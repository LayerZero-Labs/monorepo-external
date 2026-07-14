//! Unit tests for the `gen_args` function.

use crate::storage::test::gen_args_for_test;
use quote::quote;

use super::test_setup::{normalize, parse_variant};

#[test]
fn test_unit_variant_only_env_arg() {
    let variant = parse_variant(quote! {
        enum Test {
            #[persistent(u32)]
            UnitVariant,
        }
    });

    let args = gen_args_for_test(&variant);
    let expected = quote! { env };
    assert_eq!(normalize(args), normalize(expected));
}

#[test]
fn test_named_variant_single_field() {
    let variant = parse_variant(quote! {
        enum Test {
            #[persistent(u32)]
            NamedVariant { key: Address },
        }
    });

    let args = gen_args_for_test(&variant);
    let expected = quote! { env, key };
    assert_eq!(normalize(args), normalize(expected));
}

#[test]
fn test_named_variant_multiple_fields() {
    let variant = parse_variant(quote! {
        enum Test {
            #[persistent(u32)]
            NamedVariant { first: u32, second: String, third: Address },
        }
    });

    let args = gen_args_for_test(&variant);
    let expected = quote! { env, first, second, third };
    assert_eq!(normalize(args), normalize(expected));
}

#[test]
fn test_args_do_not_include_types() {
    let variant = parse_variant(quote! {
        enum Test {
            #[persistent(u32)]
            NamedVariant { key: SomeComplexType },
        }
    });

    let args = gen_args_for_test(&variant);
    let args_str = args.to_string();

    // Args should only contain identifiers, not types
    assert!(!args_str.contains("SomeComplexType"), "args should not include types");
    assert!(args_str.contains("key"), "args should include field name");
}
