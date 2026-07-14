//! Unit tests for the `gen_enum_variant` function.

use crate::storage::test::gen_enum_variant_for_test;
use crate::tests::test_helpers::assert_panics_contains;
use quote::quote;

use super::test_setup::{normalize, parse_variant};

#[test]
fn test_unit_variant() {
    let variant = parse_variant(quote! {
        enum Test {
            #[persistent(u32)]
            UnitVariant,
        }
    });

    let generated = gen_enum_variant_for_test(&variant);
    let expected = quote! { UnitVariant };
    assert_eq!(normalize(generated), normalize(expected));
}

#[test]
fn test_named_variant_single_field() {
    let variant = parse_variant(quote! {
        enum Test {
            #[persistent(u32)]
            NamedVariant { key: Address },
        }
    });

    let generated = gen_enum_variant_for_test(&variant);
    // Named fields become tuple variant with types only
    let expected = quote! { NamedVariant(Address) };
    assert_eq!(normalize(generated), normalize(expected));
}

#[test]
fn test_named_variant_multiple_fields() {
    let variant = parse_variant(quote! {
        enum Test {
            #[persistent(u32)]
            NamedVariant { first: u32, second: String, third: Address },
        }
    });

    let generated = gen_enum_variant_for_test(&variant);
    // Multiple fields become tuple variant with all types
    let expected = quote! { NamedVariant(u32, String, Address) };
    assert_eq!(normalize(generated), normalize(expected));
}

#[test]
fn test_tuple_variant_panics() {
    let variant = parse_variant(quote! {
        enum Test {
            TupleVariant(u32, String),
        }
    });

    assert_panics_contains("tuple variant", "only unit variants or named fields are supported", || {
        gen_enum_variant_for_test(&variant);
    });
}

#[test]
fn test_complex_generic_types() {
    let variant = parse_variant(quote! {
        enum Test {
            #[persistent(u32)]
            GenericVariant { key: BytesN<32>, value: Vec<u8> },
        }
    });

    let generated = gen_enum_variant_for_test(&variant);
    let expected = quote! { GenericVariant(BytesN<32>, Vec<u8>) };
    assert_eq!(normalize(generated), normalize(expected));
}
