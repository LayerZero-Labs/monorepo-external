//! Unit tests for the `VariantConfig` struct and its `TryFrom` implementation via wrapper functions.

use crate::storage::test::{get_variant_config_for_test, get_variant_method_names_for_test};
use quote::quote;

use super::test_setup::parse_variant;

// ============================================================================
// TryFrom<&Variant> Tests
// ============================================================================

#[test]
fn test_try_from_instance_variant() {
    let variant = parse_variant(quote! {
        enum Test {
            #[instance(u32)]
            Counter,
        }
    });

    let config = get_variant_config_for_test(&variant);
    assert!(config.is_ok());
    let config = config.unwrap();
    assert_eq!(config.kind_name, "instance");
    assert_eq!(config.value_type, "u32");
    assert_eq!(config.name, "counter"); // snake_case conversion
    assert!(!config.auto_ttl); // instance storage doesn't have auto TTL
    assert!(!config.has_default);
}

#[test]
fn test_try_from_persistent_variant() {
    let variant = parse_variant(quote! {
        enum Test {
            #[persistent(Address)]
            Owner,
        }
    });

    let config = get_variant_config_for_test(&variant);
    assert!(config.is_ok());
    let config = config.unwrap();
    assert_eq!(config.kind_name, "persistent");
    assert_eq!(config.value_type, "Address");
    assert_eq!(config.name, "owner");
    assert!(config.auto_ttl); // persistent has auto TTL by default
    assert!(!config.has_default);
}

#[test]
fn test_try_from_temporary_variant() {
    let variant = parse_variant(quote! {
        enum Test {
            #[temporary(bool)]
            Flag,
        }
    });

    let config = get_variant_config_for_test(&variant);
    assert!(config.is_ok());
    let config = config.unwrap();
    assert_eq!(config.kind_name, "temporary");
    assert_eq!(config.value_type, "bool");
    assert_eq!(config.name, "flag");
    assert!(!config.auto_ttl); // temporary doesn't have auto TTL
    assert!(!config.has_default);
}

#[test]
fn test_try_from_with_default() {
    let variant = parse_variant(quote! {
        enum Test {
            #[instance(u32)]
            #[default(0)]
            Counter,
        }
    });

    let config = get_variant_config_for_test(&variant);
    assert!(config.is_ok());
    let config = config.unwrap();
    assert!(config.has_default);
}

#[test]
fn test_try_from_with_custom_name() {
    let variant = parse_variant(quote! {
        enum Test {
            #[instance(u32)]
            #[name("custom_name")]
            Counter,
        }
    });

    let config = get_variant_config_for_test(&variant);
    assert!(config.is_ok());
    let config = config.unwrap();
    assert_eq!(config.name, "custom_name");
}

#[test]
fn test_try_from_snake_case_conversion() {
    let variant = parse_variant(quote! {
        enum Test {
            #[instance(u32)]
            MyLongVariantName,
        }
    });

    let config = get_variant_config_for_test(&variant);
    assert!(config.is_ok());
    let config = config.unwrap();
    assert_eq!(config.name, "my_long_variant_name");
}

#[test]
fn test_try_from_persistent_with_no_ttl_extension() {
    let variant = parse_variant(quote! {
        enum Test {
            #[persistent(u32)]
            #[no_ttl_extension]
            CachedValue,
        }
    });

    let config = get_variant_config_for_test(&variant);
    assert!(config.is_ok());
    let config = config.unwrap();
    assert_eq!(config.kind_name, "persistent");
    assert!(!config.auto_ttl); // disabled by no_ttl_extension
}

#[test]
fn test_try_from_error_no_ttl_extension_on_instance() {
    let variant = parse_variant(quote! {
        enum Test {
            #[instance(u32)]
            #[no_ttl_extension]
            Counter,
        }
    });

    let config = get_variant_config_for_test(&variant);
    assert!(config.is_err());
    let err = config.unwrap_err();
    assert!(err.contains("can only be used with #[persistent"));
}

#[test]
fn test_try_from_error_no_ttl_extension_on_temporary() {
    let variant = parse_variant(quote! {
        enum Test {
            #[temporary(u32)]
            #[no_ttl_extension]
            TempData,
        }
    });

    let config = get_variant_config_for_test(&variant);
    assert!(config.is_err());
    let err = config.unwrap_err();
    assert!(err.contains("can only be used with #[persistent"));
}

#[test]
fn test_try_from_error_unknown_attribute() {
    let variant = parse_variant(quote! {
        enum Test {
            #[persistent(u32)]
            #[unknown_attr]
            Counter,
        }
    });

    let config = get_variant_config_for_test(&variant);
    assert!(config.is_err());
    let err = config.unwrap_err();
    assert!(err.contains("unknown attribute"));
}

// ============================================================================
// method_names() Tests
// ============================================================================

#[test]
fn test_method_names_basic() {
    let variant = parse_variant(quote! {
        enum Test {
            #[instance(u32)]
            Counter,
        }
    });

    let result = get_variant_method_names_for_test(&variant);
    assert!(result.is_ok());
    let (getter, setter, remover, set_or_remove, has, ttl_extender) = result.unwrap();

    assert_eq!(getter, "counter");
    assert_eq!(setter, "set_counter");
    assert_eq!(remover, "remove_counter");
    assert_eq!(set_or_remove, "set_or_remove_counter");
    assert_eq!(has, "has_counter");
    assert_eq!(ttl_extender, "extend_counter_ttl");
}

#[test]
fn test_method_names_with_custom_name() {
    let variant = parse_variant(quote! {
        enum Test {
            #[instance(u32)]
            #[name("custom")]
            Counter,
        }
    });

    let result = get_variant_method_names_for_test(&variant);
    assert!(result.is_ok());
    let (getter, setter, remover, set_or_remove, has, ttl_extender) = result.unwrap();

    assert_eq!(getter, "custom");
    assert_eq!(setter, "set_custom");
    assert_eq!(remover, "remove_custom");
    assert_eq!(set_or_remove, "set_or_remove_custom");
    assert_eq!(has, "has_custom");
    assert_eq!(ttl_extender, "extend_custom_ttl");
}
