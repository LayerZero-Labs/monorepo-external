//! Unit tests for the `gen_key` function.

use crate::storage::test::gen_key_for_test;
use quote::{format_ident, quote};

use super::test_setup::{normalize, parse_variant, parse_variant_str};

#[test]
fn test_unit_variant_key() {
    let variant = parse_variant(quote! {
        enum TestEnum {
            #[persistent(u32)]
            UnitVariant,
        }
    });
    let enum_name = format_ident!("TestEnum");

    let generated_key = gen_key_for_test(&enum_name, &variant);
    let expected = quote! { TestEnum::UnitVariant };
    assert_eq!(normalize(generated_key), normalize(expected));
}

#[test]
fn test_named_variant_single_field_non_primitive() {
    let variant = parse_variant(quote! {
        enum TestEnum {
            #[persistent(u32)]
            NamedVariant { owner: Address },
        }
    });
    let enum_name = format_ident!("TestEnum");

    let generated_key = gen_key_for_test(&enum_name, &variant);
    // Non-primitive field identifiers should be cloned in the generated key.
    let expected = quote! { TestEnum::NamedVariant(owner.clone()) };
    assert_eq!(normalize(generated_key), normalize(expected));
}

#[test]
fn test_named_variant_single_field_primitive() {
    let variant = parse_variant(quote! {
        enum TestEnum {
            #[persistent(u32)]
            NamedVariant { counter: u32 },
        }
    });
    let enum_name = format_ident!("TestEnum");

    let generated_key = gen_key_for_test(&enum_name, &variant);
    // Primitive field identifiers should NOT be cloned in the generated key.
    let expected = quote! { TestEnum::NamedVariant(counter) };
    assert_eq!(normalize(generated_key), normalize(expected));
}

#[test]
fn test_named_variant_multiple_fields_mixed() {
    let variant = parse_variant(quote! {
        enum TestEnum {
            #[persistent(u32)]
            MixedVariant { id: u64, name: String, count: i128 },
        }
    });
    let enum_name = format_ident!("TestEnum");

    let generated_key = gen_key_for_test(&enum_name, &variant);
    // u64 and i128 are primitives (no clone), String is not (clone)
    let expected = quote! { TestEnum::MixedVariant(id, name.clone(), count) };
    assert_eq!(normalize(generated_key), normalize(expected));
}

#[test]
fn test_uses_provided_enum_name() {
    let variant = parse_variant(quote! {
        enum Dummy {
            #[persistent(u32)]
            Variant,
        }
    });
    let enum_name = format_ident!("CustomEnumName");

    let generated_key = gen_key_for_test(&enum_name, &variant);
    let expected = quote! { CustomEnumName::Variant };
    assert_eq!(normalize(generated_key), normalize(expected));
}

#[test]
fn test_all_primitives_not_cloned() {
    let primitives = ["u32", "i32", "u64", "i64", "u128", "i128", "bool"];

    for ty in primitives {
        let input = format!(
            r#"
            enum TestEnum {{
                #[persistent(u32)]
                Variant {{ key: {} }},
            }}
            "#,
            ty
        );
        let variant = parse_variant_str(&input);
        let enum_name = format_ident!("TestEnum");

        let generated_key = gen_key_for_test(&enum_name, &variant);
        let generated_str = generated_key.to_string();

        assert!(!generated_str.contains("clone"), "primitive type {} should not be cloned, got: {}", ty, generated_str);
    }
}
