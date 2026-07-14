//! Unit tests for the `parse_default` function.

use crate::storage::test::parse_default_for_test;
use quote::quote;

use super::test_setup::parse_attrs;

#[test]
fn test_no_default_returns_none() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            Variant,
        }
    });

    let result = parse_default_for_test(&attrs);
    assert!(result.is_ok());
    assert!(result.unwrap().is_none());
}

#[test]
fn test_parses_integer_default() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            #[default(42)]
            Variant,
        }
    });

    let result = parse_default_for_test(&attrs);
    assert!(result.is_ok());
    let default = result.unwrap();
    assert!(default.is_some());
    assert_eq!(quote!(#default).to_string(), "42");
}

#[test]
fn test_parses_zero_default() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            #[default(0)]
            Variant,
        }
    });

    let result = parse_default_for_test(&attrs);
    assert!(result.is_ok());
    let default = result.unwrap();
    assert!(default.is_some());
    assert_eq!(quote!(#default).to_string(), "0");
}

#[test]
fn test_parses_boolean_default() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(bool)]
            #[default(true)]
            Variant,
        }
    });

    let result = parse_default_for_test(&attrs);
    assert!(result.is_ok());
    let default = result.unwrap();
    assert!(default.is_some());
    assert_eq!(quote!(#default).to_string(), "true");
}

#[test]
fn test_parses_method_call_default() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(String)]
            #[default(String::from_str(env, "hello"))]
            Variant,
        }
    });

    let result = parse_default_for_test(&attrs);
    assert!(result.is_ok());
    let default = result.unwrap();
    assert!(default.is_some());
    let default_str = quote!(#default).to_string();
    assert!(default_str.contains("String :: from_str"));
}

#[test]
fn test_error_multiple_defaults() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            #[default(0)]
            #[default(1)]
            Variant,
        }
    });

    let result = parse_default_for_test(&attrs);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("multiple default values specified"));
}

#[test]
fn test_error_default_without_parens() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            #[default]
            Variant,
        }
    });

    let result = parse_default_for_test(&attrs);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("failed to parse default value"));
}

#[test]
fn test_error_default_empty_parens() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            #[default()]
            Variant,
        }
    });

    let result = parse_default_for_test(&attrs);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("failed to parse default value"));
}

#[test]
fn test_empty_attrs_returns_none() {
    let attrs: Vec<syn::Attribute> = vec![];

    let result = parse_default_for_test(&attrs);
    assert!(result.is_ok());
    assert!(result.unwrap().is_none());
}

#[test]
fn test_parses_negative_default() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(i64)]
            #[default(-100)]
            Variant,
        }
    });

    let result = parse_default_for_test(&attrs);
    assert!(result.is_ok());
    let default = result.unwrap();
    assert!(default.is_some());
    assert_eq!(quote!(#default).to_string(), "- 100");
}
