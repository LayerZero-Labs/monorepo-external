//! Unit tests for the `gen_accessor_methods` function.

use crate::storage::test::gen_accessor_methods_for_test;
use proc_macro2::Ident;
use quote::{format_ident, quote, ToTokens};
use syn::{ImplItem, ImplItemFn, ItemImpl, ReturnType, Type, Variant};

use super::test_setup::{normalize, parse_variant};

fn gen_impl(enum_name: &Ident, variant: &Variant) -> ItemImpl {
    let methods = gen_accessor_methods_for_test(enum_name, variant);
    syn::parse2::<ItemImpl>(quote! { impl #enum_name { #methods } }).expect("failed to parse generated methods")
}

fn impl_fn_names(item_impl: &ItemImpl) -> Vec<String> {
    item_impl
        .items
        .iter()
        .filter_map(|it| match it {
            ImplItem::Fn(f) => Some(f.sig.ident.to_string()),
            _ => None,
        })
        .collect()
}

fn find_fn<'a>(item_impl: &'a ItemImpl, name: &str) -> &'a ImplItemFn {
    item_impl
        .items
        .iter()
        .find_map(|it| match it {
            ImplItem::Fn(f) if f.sig.ident == name => Some(f),
            _ => None,
        })
        .unwrap_or_else(|| panic!("expected to find function '{name}' in generated impl"))
}

fn output_type(sig: &syn::Signature) -> Option<&Type> {
    match &sig.output {
        ReturnType::Default => None,
        ReturnType::Type(_, ty) => Some(ty.as_ref()),
    }
}

#[test]
fn generates_all_expected_methods_for_unit_variant() {
    let variant = parse_variant(quote! {
        enum TestEnum {
            #[persistent(u32)]
            Counter,
        }
    });
    let enum_name = format_ident!("TestEnum");

    let item_impl = gen_impl(&enum_name, &variant);
    let mut names = impl_fn_names(&item_impl);
    names.sort();

    // Getter + CRUD-ish methods + TTL extender are always generated.
    assert_eq!(
        names,
        vec!["counter", "extend_counter_ttl", "has_counter", "remove_counter", "set_counter", "set_or_remove_counter",]
    );
}

#[test]
fn uses_correct_storage_accessor_for_each_kind() {
    let enum_name = format_ident!("TestEnum");

    let variant = parse_variant(quote! {
        enum TestEnum {
            #[instance(u32)]
            Counter,
        }
    });
    let instance = gen_accessor_methods_for_test(&enum_name, &variant);
    let instance_norm = normalize(instance);
    let expected_instance = normalize(quote!(env.storage().instance()));
    assert!(instance_norm.contains(&expected_instance));

    let variant = parse_variant(quote! {
        enum TestEnum {
            #[persistent(u32)]
            Counter,
        }
    });
    let persistent = gen_accessor_methods_for_test(&enum_name, &variant);
    let persistent_norm = normalize(persistent);
    let expected_persistent = normalize(quote!(env.storage().persistent()));
    assert!(persistent_norm.contains(&expected_persistent));

    let variant = parse_variant(quote! {
        enum TestEnum {
            #[temporary(u32)]
            Counter,
        }
    });
    let temporary = gen_accessor_methods_for_test(&enum_name, &variant);
    let temporary_norm = normalize(temporary);
    let expected_temporary = normalize(quote!(env.storage().temporary()));
    assert!(temporary_norm.contains(&expected_temporary));
}

#[test]
fn persistent_includes_auto_ttl_and_can_be_disabled() {
    let variant = parse_variant(quote! {
        enum TestEnum {
            #[persistent(u32)]
            Counter,
        }
    });
    let enum_name = format_ident!("TestEnum");

    let methods = gen_accessor_methods_for_test(&enum_name, &variant);
    let methods_str = normalize(methods);

    assert!(
        methods_str.contains("utils :: ttl_configurable :: extend_persistent_ttl"),
        "persistent storage should include auto TTL extension"
    );

    let variant = parse_variant(quote! {
        enum TestEnum {
            #[persistent(u32)]
            #[no_ttl_extension]
            Counter,
        }
    });
    let methods = gen_accessor_methods_for_test(&enum_name, &variant);
    let methods_str = normalize(methods);

    assert!(
        !methods_str.contains("utils :: ttl_configurable :: extend_persistent_ttl"),
        "no_ttl_extension should disable auto TTL extension"
    );
}

#[test]
fn default_value_changes_getter_return_type_and_body() {
    let variant = parse_variant(quote! {
        enum TestEnum {
            #[instance(u32)]
            #[default(0)]
            Counter,
        }
    });
    let enum_name = format_ident!("TestEnum");

    let item_impl = gen_impl(&enum_name, &variant);
    let getter = find_fn(&item_impl, "counter");

    // With default, return type should be the value type directly, not Option<...>
    let out = output_type(&getter.sig).expect("getter should have an explicit return type");
    assert_eq!(normalize(out.to_token_stream()), normalize(quote!(u32)));

    let body = normalize(getter.block.to_token_stream());
    assert!(body.contains("unwrap_or"), "getter should apply default via unwrap_or(...)");
}

#[test]
fn no_default_getter_returns_option() {
    let variant = parse_variant(quote! {
        enum TestEnum {
            #[instance(u32)]
            Counter,
        }
    });
    let enum_name = format_ident!("TestEnum");

    let item_impl = gen_impl(&enum_name, &variant);
    let getter = find_fn(&item_impl, "counter");

    let out = output_type(&getter.sig).expect("getter should have an explicit return type");
    assert_eq!(normalize(out.to_token_stream()), normalize(quote!(Option<u32>)));
}

#[test]
fn snake_case_and_custom_name_attribute_are_applied() {
    let variant = parse_variant(quote! {
        enum TestEnum {
            #[instance(u32)]
            MyLongVariantName,
        }
    });
    let enum_name = format_ident!("TestEnum");

    let item_impl = gen_impl(&enum_name, &variant);
    let names = impl_fn_names(&item_impl);

    assert!(names.iter().any(|n| n == "my_long_variant_name"), "should convert to snake_case");
    assert!(names.iter().any(|n| n == "set_my_long_variant_name"), "setter should use snake_case");

    let variant = parse_variant(quote! {
        enum TestEnum {
            #[instance(u32)]
            #[name("custom_name")]
            Counter,
        }
    });
    let item_impl = gen_impl(&enum_name, &variant);
    let names = impl_fn_names(&item_impl);

    assert!(names.iter().any(|n| n == "custom_name"), "should use custom name for getter");
    assert!(names.iter().any(|n| n == "set_custom_name"), "should use custom name for setter");
}

#[test]
fn named_variant_generates_expected_param_passing_rules() {
    let variant = parse_variant(quote! {
        enum TestEnum {
            #[instance(u32)]
            Nonce { nonce: u32, user: Address },
        }
    });
    let enum_name = format_ident!("TestEnum");

    let item_impl = gen_impl(&enum_name, &variant);
    let getter = find_fn(&item_impl, "nonce");
    let sig_norm = normalize(getter.sig.to_token_stream());

    // Non-primitive types are passed by reference, primitives by value.
    assert!(sig_norm.contains("nonce : u32"), "primitive field should be passed by value");
    assert!(sig_norm.contains("user : & Address"), "non-primitive field should be passed by reference");
}
