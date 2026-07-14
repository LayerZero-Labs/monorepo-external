//! Unit tests for the `extract_fields` function.

use crate::storage::test::extract_fields_for_test;
use crate::tests::test_helpers::assert_panics_contains;
use quote::{quote, ToTokens};

use super::test_setup::parse_variant;

#[test]
fn test_unit_variant_returns_empty() {
    let variant = parse_variant(quote! {
        enum Test {
            #[persistent(u32)]
            UnitVariant,
        }
    });

    let fields = extract_fields_for_test(&variant);
    assert!(fields.is_empty(), "unit variant should have no fields");
}

#[test]
fn test_named_variant_single_field() {
    let variant = parse_variant(quote! {
        enum Test {
            #[persistent(u32)]
            NamedVariant { key: Address },
        }
    });

    let fields = extract_fields_for_test(&variant);
    assert_eq!(fields.len(), 1, "should have exactly one field");
    assert_eq!(fields[0].0.to_string(), "key");
    assert_eq!(fields[0].1.to_token_stream().to_string(), "Address");
}

#[test]
fn test_named_variant_multiple_fields() {
    let variant = parse_variant(quote! {
        enum Test {
            #[persistent(u32)]
            NamedVariant { first: u32, second: String, third: Address },
        }
    });

    let fields = extract_fields_for_test(&variant);
    assert_eq!(fields.len(), 3, "should have exactly three fields");
    assert_eq!(fields[0].0.to_string(), "first");
    assert_eq!(fields[1].0.to_string(), "second");
    assert_eq!(fields[2].0.to_string(), "third");

    assert_eq!(fields[0].1.to_token_stream().to_string(), "u32");
    assert_eq!(fields[1].1.to_token_stream().to_string(), "String");
    assert_eq!(fields[2].1.to_token_stream().to_string(), "Address");
}

#[test]
fn test_tuple_variant_panics() {
    let variant = parse_variant(quote! {
        enum Test {
            TupleVariant(u32, String),
        }
    });

    assert_panics_contains("tuple variant", "only unit variants or named fields are supported", || {
        extract_fields_for_test(&variant);
    });
}

#[test]
fn test_preserves_field_order() {
    let variant = parse_variant(quote! {
        enum Test {
            #[persistent(u32)]
            OrderedVariant { alpha: u32, beta: String, gamma: Address, delta: bool },
        }
    });

    let fields = extract_fields_for_test(&variant);
    let names: Vec<_> = fields.iter().map(|(name, _)| name.to_string()).collect();
    assert_eq!(names, vec!["alpha", "beta", "gamma", "delta"]);

    assert_eq!(fields[0].1.to_token_stream().to_string(), "u32");
    assert_eq!(fields[1].1.to_token_stream().to_string(), "String");
    assert_eq!(fields[2].1.to_token_stream().to_string(), "Address");
    assert_eq!(fields[3].1.to_token_stream().to_string(), "bool");
}
