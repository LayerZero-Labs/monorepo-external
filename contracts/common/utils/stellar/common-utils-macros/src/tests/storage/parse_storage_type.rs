//! Unit tests for the `parse_storage_type` function.

use crate::storage::test::parse_storage_type_for_test;
use crate::tests::test_helpers::assert_panics_contains;
use quote::quote;

use super::test_setup::parse_attrs;

#[test]
fn test_parses_instance_storage() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[instance(u32)]
            Variant,
        }
    });

    let result = parse_storage_type_for_test(&attrs);
    assert!(result.is_ok());
    let (kind_name, ty) = result.unwrap();
    assert_eq!(kind_name, "instance");
    assert_eq!(quote!(#ty).to_string(), "u32");
}

#[test]
fn test_parses_persistent_storage() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(Address)]
            Variant,
        }
    });

    let result = parse_storage_type_for_test(&attrs);
    assert!(result.is_ok());
    let (kind_name, ty) = result.unwrap();
    assert_eq!(kind_name, "persistent");
    assert_eq!(quote!(#ty).to_string(), "Address");
}

#[test]
fn test_parses_temporary_storage() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[temporary(bool)]
            Variant,
        }
    });

    let result = parse_storage_type_for_test(&attrs);
    assert!(result.is_ok());
    let (kind_name, ty) = result.unwrap();
    assert_eq!(kind_name, "temporary");
    assert_eq!(quote!(#ty).to_string(), "bool");
}

#[test]
fn test_parses_complex_type() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(Option<Address>)]
            Variant,
        }
    });

    let result = parse_storage_type_for_test(&attrs);
    assert!(result.is_ok());
    let (kind_name, ty) = result.unwrap();
    assert_eq!(kind_name, "persistent");
    assert_eq!(quote!(#ty).to_string(), "Option < Address >");
}

#[test]
fn test_parses_generic_type_with_multiple_params() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(Map<Address, u64>)]
            Variant,
        }
    });

    let result = parse_storage_type_for_test(&attrs);
    assert!(result.is_ok());
    let (_, ty) = result.unwrap();
    assert_eq!(quote!(#ty).to_string(), "Map < Address , u64 >");
}

#[test]
fn test_error_missing_storage_type() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[default(0)]
            Variant,
        }
    });

    let result = parse_storage_type_for_test(&attrs);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("storage type must be specified exactly once"));
}

#[test]
fn test_error_empty_attrs() {
    let attrs: Vec<syn::Attribute> = vec![];

    let result = parse_storage_type_for_test(&attrs);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("storage type must be specified exactly once"));
}

#[test]
fn test_error_multiple_storage_types() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[instance(u32)]
            #[persistent(u32)]
            Variant,
        }
    });

    let result = parse_storage_type_for_test(&attrs);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.contains("storage type must be specified exactly once"));
}

#[test]
fn test_panics_missing_type_param() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[instance]
            Variant,
        }
    });

    assert_panics_contains("missing type param", "failed to parse storage type", || {
        let _ = parse_storage_type_for_test(&attrs);
    });
}

#[test]
fn test_panics_invalid_type_param() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32, String)]
            Variant,
        }
    });

    assert_panics_contains("multiple type params", "failed to parse storage type", || {
        let _ = parse_storage_type_for_test(&attrs);
    });
}

#[test]
fn test_ignores_non_storage_attrs() {
    let attrs = parse_attrs(quote! {
        enum Test {
            /// Doc comment
            #[default(0)]
            #[name("custom")]
            #[persistent(u64)]
            Variant,
        }
    });

    let result = parse_storage_type_for_test(&attrs);
    assert!(result.is_ok());
    let (kind_name, ty) = result.unwrap();
    assert_eq!(kind_name, "persistent");
    assert_eq!(quote!(#ty).to_string(), "u64");
}
