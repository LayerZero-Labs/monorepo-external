//! Unit tests for the `parse_no_ttl_extension` function.

use crate::storage::test::parse_no_ttl_extension_for_test;
use quote::quote;

use super::test_setup::parse_attrs;

#[test]
fn test_no_attribute_returns_false() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            Variant,
        }
    });

    let result = parse_no_ttl_extension_for_test(&attrs);
    assert!(result.is_ok());
    assert!(!result.unwrap());
}

#[test]
fn test_attribute_present_returns_true() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            #[no_ttl_extension]
            Variant,
        }
    });

    let result = parse_no_ttl_extension_for_test(&attrs);
    assert!(result.is_ok());
    assert!(result.unwrap());
}

#[test]
fn test_attribute_before_storage_type() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[no_ttl_extension]
            #[persistent(u32)]
            Variant,
        }
    });

    let result = parse_no_ttl_extension_for_test(&attrs);
    assert!(result.is_ok());
    assert!(result.unwrap());
}

#[test]
fn test_error_attribute_with_parens() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            #[no_ttl_extension()]
            Variant,
        }
    });

    let result = parse_no_ttl_extension_for_test(&attrs);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("does not accept arguments"));
}

#[test]
fn test_error_attribute_with_value() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            #[no_ttl_extension(true)]
            Variant,
        }
    });

    let result = parse_no_ttl_extension_for_test(&attrs);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("does not accept arguments"));
}

#[test]
fn test_error_attribute_with_key_value() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            #[no_ttl_extension = true]
            Variant,
        }
    });

    let result = parse_no_ttl_extension_for_test(&attrs);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("does not accept arguments"));
}

#[test]
fn test_error_multiple_attributes() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            #[no_ttl_extension]
            #[no_ttl_extension]
            Variant,
        }
    });

    let result = parse_no_ttl_extension_for_test(&attrs);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("multiple #[no_ttl_extension]"));
}

#[test]
fn test_empty_attrs_returns_false() {
    let attrs: Vec<syn::Attribute> = vec![];

    let result = parse_no_ttl_extension_for_test(&attrs);
    assert!(result.is_ok());
    assert!(!result.unwrap());
}
