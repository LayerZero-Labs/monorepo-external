use quote::quote;

use crate::tests::test_helpers::{assert_panics_contains, filter_item_inputs_excluding_labels};

#[test]
fn test_non_enum_input() {
    for (case, input) in filter_item_inputs_excluding_labels(&["enum"]) {
        assert_panics_contains(case, "failed to parse enum", || {
            crate::storage::generate_storage(input.clone());
        });
    }
}

#[test]
fn test_tuple_variant_rejected() {
    let cases = vec![
        (
            "instance tuple variant",
            quote! {
                enum TestEnum {
                    #[instance(u32)]
                    TupleVariant(String, u32),
                }
            },
        ),
        (
            "persistent tuple variant",
            quote! {
                enum TestEnum {
                    #[persistent(u32)]
                    TupleVariant(String, u32),
                }
            },
        ),
    ];

    for (case, input) in cases {
        assert_panics_contains(case, "only unit variants or named fields are supported", || {
            crate::storage::generate_storage(input.clone());
        });
    }
}

#[test]
fn test_attribute_errors() {
    let cases_storage_type = vec![
        (
            "missing storage type",
            "storage type must be specified exactly once",
            quote! {
                enum TestEnum { Counter }
            },
        ),
        (
            "multiple storage types",
            "storage type must be specified exactly once",
            quote! {
                enum TestEnum {
                    #[instance(u32)]
                    #[persistent(u32)]
                    Counter,
                }
            },
        ),
        (
            "invalid storage type with another valid storage type",
            "failed to parse storage type",
            quote! {
                enum TestEnum {
                    #[persistent(u32)]
                    #[instance]
                    Counter,
                }
            },
        ),
        (
            "missing type param",
            "failed to parse storage type for",
            quote! {
                enum TestEnum {
                    #[instance]
                    Counter,
                }
            },
        ),
        (
            "invalid type param",
            "failed to parse storage type for",
            quote! {
                enum TestEnum {
                    #[persistent(u32, String)]
                    Counter,
                }
            },
        ),
    ];

    for (case, expected, input) in cases_storage_type {
        assert_panics_contains(case, expected, || {
            crate::storage::generate_storage(input.clone());
        });
    }

    let cases_default = vec![
        (
            "multiple defaults",
            "multiple default values specified",
            quote! {
                enum TestEnum {
                    #[persistent(u32)]
                    #[default(0)]
                    #[default(1)]
                    Counter,
                }
            },
        ),
        (
            "invalid default value",
            "failed to parse default value",
            quote! {
                enum TestEnum {
                    #[persistent(u32)]
                    #[default(!@#$%)]
                    Counter,
                }
            },
        ),
        (
            "default without parens",
            "failed to parse default value",
            quote! {
                enum TestEnum {
                    #[persistent(u32)]
                    #[default]
                    Counter,
                }
            },
        ),
        (
            "default with empty parens",
            "failed to parse default value",
            quote! {
                enum TestEnum {
                    #[persistent(u32)]
                    #[default()]
                    Counter,
                }
            },
        ),
    ];

    for (case, expected, input) in cases_default {
        assert_panics_contains(case, expected, || {
            crate::storage::generate_storage(input.clone());
        });
    }

    let cases_name = vec![
        (
            "multiple name attrs",
            "multiple name attributes specified",
            quote! {
                enum TestEnum {
                    #[persistent(u32)]
                    #[name("foo")]
                    #[name("bar")]
                    Counter,
                }
            },
        ),
        (
            "invalid name attr",
            "failed to parse name attribute",
            quote! {
                enum TestEnum {
                    #[persistent(u32)]
                    #[name(123)]
                    Counter,
                }
            },
        ),
        (
            "name without parens",
            "failed to parse name attribute",
            quote! {
                enum TestEnum {
                    #[persistent(u32)]
                    #[name]
                    Counter,
                }
            },
        ),
        (
            "name with empty parens",
            "failed to parse name attribute",
            quote! {
                enum TestEnum {
                    #[persistent(u32)]
                    #[name()]
                    Counter,
                }
            },
        ),
    ];

    for (case, expected, input) in cases_name {
        assert_panics_contains(case, expected, || {
            crate::storage::generate_storage(input.clone());
        });
    }

    assert_panics_contains("unknown attribute", "unknown attribute", || {
        let input = quote! {
            enum TestEnum {
                #[persistent(u32)]
                #[unknown_attr]
                Counter,
            }
        };
        crate::storage::generate_storage(input);
    });

    // Test #[no_ttl_extension] validation
    let cases_no_ttl = vec![
        (
            "no_ttl_extension does not accept arguments",
            "does not accept arguments",
            quote! {
                enum TestEnum {
                    #[persistent(u32)]
                    #[no_ttl_extension(foo)]
                    Counter,
                }
            },
        ),
        (
            "multiple no_ttl_extension",
            "multiple #[no_ttl_extension]",
            quote! {
                enum TestEnum {
                    #[persistent(u32)]
                    #[no_ttl_extension]
                    #[no_ttl_extension]
                    Counter,
                }
            },
        ),
        (
            "triple no_ttl_extension",
            "multiple #[no_ttl_extension]",
            quote! {
                enum TestEnum {
                    #[persistent(u32)]
                    #[no_ttl_extension]
                    #[no_ttl_extension]
                    #[no_ttl_extension]
                    Counter,
                }
            },
        ),
        (
            "no_ttl_extension on instance",
            "can only be used with #[persistent",
            quote! {
                enum TestEnum {
                    #[instance(u32)]
                    #[no_ttl_extension]
                    Counter,
                }
            },
        ),
        (
            "no_ttl_extension on instance with default",
            "can only be used with #[persistent",
            quote! {
                enum TestEnum {
                    #[instance(u32)]
                    #[default(0)]
                    #[no_ttl_extension]
                    Counter,
                }
            },
        ),
        (
            "no_ttl_extension before instance storage type",
            "can only be used with #[persistent",
            quote! {
                enum TestEnum {
                    #[no_ttl_extension]
                    #[instance(u32)]
                    Counter,
                }
            },
        ),
        (
            "no_ttl_extension on temporary",
            "can only be used with #[persistent",
            quote! {
                enum TestEnum {
                    #[temporary(u32)]
                    #[no_ttl_extension]
                    Counter,
                }
            },
        ),
        (
            "no_ttl_extension before temporary storage type",
            "can only be used with #[persistent",
            quote! {
                enum TestEnum {
                    #[no_ttl_extension]
                    #[temporary(u32)]
                    Counter,
                }
            },
        ),
        (
            "no_ttl_extension on instance in multi-variant enum",
            "can only be used with #[persistent",
            quote! {
                enum TestEnum {
                    #[persistent(u32)]
                    ValidVariant,

                    #[instance(u32)]
                    #[no_ttl_extension]
                    InvalidVariant,
                }
            },
        ),
    ];

    for (case, expected, input) in cases_no_ttl {
        assert_panics_contains(case, expected, || {
            crate::storage::generate_storage(input.clone());
        });
    }
}

// ============================================
// Valid Cases: Snapshot Tests for Generated Code
// ============================================

/// Comprehensive snapshot test covering all storage macro features:
/// - All storage types: instance, persistent, temporary
/// - Unit variants and named field variants (single and multiple fields)
/// - Default values (with and without)
/// - TTL extension control (auto for persistent, opt-out with #[no_ttl_extension])
/// - Custom name attribute
/// - snake_case naming conversion (TempData -> temp_data)
/// - Primitive vs non-primitive key types (by value vs by reference + clone)
///
/// Note: Primitive type detection is exhaustively tested in test_is_primitive_type_* unit tests.
/// This snapshot only needs one of each to verify the generated code integrates correctly.
#[test]
fn snapshot_generated_storage_code() {
    let input = quote! {
        /// Enum-level doc comment
        pub enum StorageKeys {
            /// Instance storage with default value
            #[instance(u32)]
            #[default(0)]
            Counter,

            /// Persistent storage with single field and default (auto TTL)
            #[persistent(String)]
            #[default(String::from_str(env, "hello"))]
            Message { sender: Address },

            /// Temporary storage with single field
            #[temporary(bool)]
            Flag { key: String },

            /// Persistent storage without fields or default
            #[persistent(Address)]
            Owner,

            /// Custom #[name()] override
            #[persistent(Option<Address>)]
            #[name("custom_key_name")]
            OptionalData { key: BytesN<32> },

            /// Temporary storage unit variant (also tests snake_case: TempData -> temp_data)
            #[temporary(u64)]
            TempData,

            /// Primitive key type: passed by value, no clone
            #[persistent(u32)]
            PrimitiveKey { key: u32 },

            /// Non-primitive key type: passed by reference, cloned
            #[instance(u32)]
            NonPrimitiveKey { key: String },

            /// Multiple fields with mixed primitive/non-primitive types
            #[persistent(u32)]
            NamedVariant { first: u32, second: String, third: Address },

            /// #[no_ttl_extension] opt-out for persistent storage
            #[persistent(u64)]
            #[no_ttl_extension]
            CachedValue { key: Address },
        }
    };

    let result = crate::storage::generate_storage(input);
    let formatted = prettyplease::unparse(&syn::parse2::<syn::File>(result).expect("failed to parse generated code"));

    insta::assert_snapshot!(formatted);
}
