//! Unit tests for the `parse_name` function.

use crate::storage::test::parse_name_for_test;
use quote::quote;

use super::test_setup::parse_attrs;

#[test]
fn test_no_name_returns_none() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            Variant,
        }
    });

    let result = parse_name_for_test(&attrs);
    assert!(result.is_ok());
    assert!(result.unwrap().is_none());
}

#[test]
fn test_parses_custom_name() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            #[name("custom_name")]
            Variant,
        }
    });

    let result = parse_name_for_test(&attrs);
    assert!(result.is_ok());
    let name = result.unwrap();
    assert_eq!(name, Some("custom_name".to_string()));
}

#[test]
fn test_parses_name_with_underscores() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            #[name("my_custom_storage_key")]
            Variant,
        }
    });

    let result = parse_name_for_test(&attrs);
    assert!(result.is_ok());
    let name = result.unwrap();
    assert_eq!(name, Some("my_custom_storage_key".to_string()));
}

#[test]
fn test_error_multiple_names() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            #[name("first")]
            #[name("second")]
            Variant,
        }
    });

    let result = parse_name_for_test(&attrs);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("multiple name attributes specified"));
}

#[test]
fn test_error_name_without_parens() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            #[name]
            Variant,
        }
    });

    let result = parse_name_for_test(&attrs);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("failed to parse name attribute"));
}

#[test]
fn test_error_name_empty_parens() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            #[name()]
            Variant,
        }
    });

    let result = parse_name_for_test(&attrs);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("failed to parse name attribute"));
}

#[test]
fn test_error_name_with_integer() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            #[name(123)]
            Variant,
        }
    });

    let result = parse_name_for_test(&attrs);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("failed to parse name attribute"));
}

#[test]
fn test_error_name_with_identifier() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            #[name(some_ident)]
            Variant,
        }
    });

    let result = parse_name_for_test(&attrs);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("failed to parse name attribute"));
}

#[test]
fn test_empty_attrs_returns_none() {
    let attrs: Vec<syn::Attribute> = vec![];

    let result = parse_name_for_test(&attrs);
    assert!(result.is_ok());
    assert!(result.unwrap().is_none());
}

#[test]
fn test_parses_name_with_special_chars() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            #[name("key_v2_beta")]
            Variant,
        }
    });

    let result = parse_name_for_test(&attrs);
    assert!(result.is_ok());
    let name = result.unwrap();
    assert_eq!(name, Some("key_v2_beta".to_string()));
}
