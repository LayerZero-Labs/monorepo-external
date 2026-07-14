//! Unit tests for the `validate_attrs` function.

use crate::storage::test::{known_attrs_for_test, validate_attrs_for_test};
use quote::{format_ident, quote};

use super::test_setup::parse_attrs;

#[test]
fn test_accepts_known_attributes() {
    let known_attrs = known_attrs_for_test();

    for attr_name in known_attrs {
        if *attr_name == "doc" {
            // doc attribute uses /// syntax
            let attrs = parse_attrs(quote! {
                enum Test {
                    /// This is a doc comment
                    #[persistent(u32)]
                    Variant,
                }
            });
            let variant_ident = format_ident!("Variant");
            assert!(validate_attrs_for_test(&attrs, &variant_ident).is_ok(), "doc attribute should be accepted");
        } else {
            // Other attributes use #[attr] or #[attr(...)] syntax
            let input = match *attr_name {
                "instance" => quote! {
                    enum Test {
                        #[instance(u32)]
                        Variant,
                    }
                },
                "persistent" => quote! {
                    enum Test {
                        #[persistent(u32)]
                        Variant,
                    }
                },
                "temporary" => quote! {
                    enum Test {
                        #[temporary(u32)]
                        Variant,
                    }
                },
                "default" => quote! {
                    enum Test {
                        #[persistent(u32)]
                        #[default(0)]
                        Variant,
                    }
                },
                "name" => quote! {
                    enum Test {
                        #[persistent(u32)]
                        #[name("custom")]
                        Variant,
                    }
                },
                "no_ttl_extension" => quote! {
                    enum Test {
                        #[persistent(u32)]
                        #[no_ttl_extension]
                        Variant,
                    }
                },
                _ => continue,
            };

            let attrs = parse_attrs(input);
            let variant_ident = format_ident!("Variant");
            assert!(
                validate_attrs_for_test(&attrs, &variant_ident).is_ok(),
                "attribute '{}' should be accepted",
                attr_name
            );
        }
    }
}

#[test]
fn test_rejects_unknown_attribute() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            #[unknown_attr]
            Variant,
        }
    });
    let variant_ident = format_ident!("Variant");

    let result = validate_attrs_for_test(&attrs, &variant_ident);
    assert!(result.is_err(), "unknown attribute should be rejected");
    let err = result.unwrap_err();
    assert!(
        err.contains("unknown attribute 'unknown_attr' on variant 'Variant'"),
        "error should mention unknown attribute"
    );
}

#[test]
fn test_accepts_multiple_valid_attributes() {
    let attrs = parse_attrs(quote! {
        enum Test {
            /// Doc comment
            #[persistent(u32)]
            #[default(0)]
            #[name("custom")]
            Variant,
        }
    });
    let variant_ident = format_ident!("Variant");

    assert!(validate_attrs_for_test(&attrs, &variant_ident).is_ok(), "multiple valid attributes should be accepted");
}

#[test]
fn test_empty_attrs_is_valid() {
    let attrs: Vec<syn::Attribute> = vec![];
    let variant_ident = format_ident!("Variant");

    // Empty attrs is valid for validate_attrs (storage type check is separate)
    assert!(validate_attrs_for_test(&attrs, &variant_ident).is_ok());
}

#[test]
fn test_rejects_path_attribute() {
    let attrs = parse_attrs(quote! {
        enum Test {
            #[persistent(u32)]
            #[some::path::attr]
            Variant,
        }
    });
    let variant_ident = format_ident!("Variant");

    let result = validate_attrs_for_test(&attrs, &variant_ident);
    assert!(result.is_err(), "path attributes should be rejected");
}
