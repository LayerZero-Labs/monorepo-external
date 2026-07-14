use quote::quote;
use syn::{parse_quote, punctuated::Punctuated, token::Comma, FnArg};

use crate::tests::test_helpers::assert_panics_contains;

// ============================================
// find_env_param Tests
// ============================================

fn parse_fn_args(input: proc_macro2::TokenStream) -> Punctuated<FnArg, Comma> {
    let item_fn: syn::ItemFn = syn::parse2(input).expect("failed to parse function");
    item_fn.sig.inputs
}

#[test]
fn test_find_env_param_owned_env_is_not_reference() {
    let args = parse_fn_args(quote! { fn f(env: Env) {} });
    let param = crate::utils::find_env_param(&args);
    assert!(param.is_some());
    let param = param.unwrap();
    assert_eq!(param.ident.to_string(), "env");
    assert!(!param.is_reference, "Env should not be marked as reference");
}

#[test]
fn test_find_env_param_ref_env_is_reference() {
    let args = parse_fn_args(quote! { fn f(env: &Env) {} });
    let param = crate::utils::find_env_param(&args);
    assert!(param.is_some());
    let param = param.unwrap();
    assert_eq!(param.ident.to_string(), "env");
    assert!(param.is_reference, "&Env should be marked as reference");
}

#[test]
fn test_find_env_param_mut_ref_env_is_reference() {
    let args = parse_fn_args(quote! { fn f(env: &mut Env) {} });
    let param = crate::utils::find_env_param(&args);
    assert!(param.is_some());
    let param = param.unwrap();
    assert_eq!(param.ident.to_string(), "env");
    assert!(param.is_reference, "&mut Env should be marked as reference");
}

#[test]
fn test_find_env_param_qualified_owned_env() {
    let args = parse_fn_args(quote! { fn f(my_env: soroban_sdk::Env) {} });
    let param = crate::utils::find_env_param(&args);
    assert!(param.is_some());
    let param = param.unwrap();
    assert_eq!(param.ident.to_string(), "my_env");
    assert!(!param.is_reference, "soroban_sdk::Env should not be marked as reference");
}

#[test]
fn test_find_env_param_qualified_ref_env() {
    let args = parse_fn_args(quote! { fn f(my_env: &soroban_sdk::Env) {} });
    let param = crate::utils::find_env_param(&args);
    assert!(param.is_some());
    let param = param.unwrap();
    assert_eq!(param.ident.to_string(), "my_env");
    assert!(param.is_reference, "&soroban_sdk::Env should be marked as reference");
}

#[test]
fn test_find_env_param_returns_none_for_no_env() {
    let args = parse_fn_args(quote! { fn f(x: u32) {} });
    let param = crate::utils::find_env_param(&args);
    assert!(param.is_none());
}

#[test]
fn test_find_env_param_finds_deeply_nested_env() {
    let args = parse_fn_args(quote! { fn f(e: some::deep::module::Env) {} });
    let param = crate::utils::find_env_param(&args);
    assert!(param.is_some());
    let param = param.unwrap();
    assert_eq!(param.ident.to_string(), "e");
    assert!(!param.is_reference, "some::deep::module::Env should not be marked as reference");
}

#[test]
fn test_find_env_param_finds_env_not_first_param() {
    let args = parse_fn_args(quote! { fn f(x: u32, y: String, env: &Env) {} });
    let param = crate::utils::find_env_param(&args);
    assert!(param.is_some());
    let param = param.unwrap();
    assert_eq!(param.ident.to_string(), "env");
    assert!(param.is_reference, "&Env should be marked as reference");
}

#[test]
fn test_find_env_param_returns_first_env_when_multiple() {
    let args = parse_fn_args(quote! { fn f(first_env: Env, second_env: Env) {} });
    let param = crate::utils::find_env_param(&args);
    assert!(param.is_some());
    let param = param.unwrap();
    assert_eq!(param.ident.to_string(), "first_env");
    assert!(!param.is_reference, "first_env should not be marked as reference");
}

#[test]
fn test_find_env_param_returns_none_for_empty_args() {
    let args = parse_fn_args(quote! { fn f() {} });
    let param = crate::utils::find_env_param(&args);
    assert!(param.is_none());
}

#[test]
fn test_find_env_param_returns_none_for_wildcard_pattern() {
    // Wildcard pattern _ is not a valid identifier pattern
    let args = parse_fn_args(quote! { fn f(_: Env) {} });
    let param = crate::utils::find_env_param(&args);
    assert!(param.is_none());
}

#[test]
fn test_find_env_param_returns_none_for_tuple_pattern() {
    // Tuple destructuring is not a simple identifier pattern
    let args = parse_fn_args(quote! { fn f((env, _): (Env, u32)) {} });
    let param = crate::utils::find_env_param(&args);
    assert!(param.is_none());
}

#[test]
fn test_find_env_param_ignores_self_receiver() {
    // Method with self receiver - find_env_param should skip receiver and find env
    let args: Punctuated<FnArg, Comma> = parse_quote!(&self, env: &Env);
    let param = crate::utils::find_env_param(&args);
    assert!(param.is_some());
    let param = param.unwrap();
    assert_eq!(param.ident.to_string(), "env");
    assert!(param.is_reference, "&Env should be marked as reference");
}

#[test]
fn test_find_env_param_returns_none_for_self_only() {
    // Method with only self receiver
    let args: Punctuated<FnArg, Comma> = parse_quote!(&self);
    let param = crate::utils::find_env_param(&args);
    assert!(param.is_none());
}

#[test]
fn test_find_env_param_with_double_reference() {
    let args = parse_fn_args(quote! { fn f(env: &&Env) {} });
    let param = crate::utils::find_env_param(&args);
    assert!(param.is_some());
    let param = param.unwrap();
    assert_eq!(param.ident.to_string(), "env");
    assert!(param.is_reference, "&&Env should be marked as reference");
}

// ============================================
// expect_env_param Tests
// ============================================

#[test]
fn test_expect_env_param_returns_param_for_owned_env() {
    let args = parse_fn_args(quote! { fn f(env: Env) {} });
    let param = crate::utils::expect_env_param(&args);
    assert_eq!(param.ident.to_string(), "env");
    assert!(!param.is_reference);
}

#[test]
fn test_expect_env_param_returns_param_for_ref_env() {
    let args = parse_fn_args(quote! { fn f(env: &Env) {} });
    let param = crate::utils::expect_env_param(&args);
    assert_eq!(param.ident.to_string(), "env");
    assert!(param.is_reference);
}

#[test]
fn test_expect_env_param_panics_when_no_env() {
    assert_panics_contains("no Env param", "function must have an Env argument", || {
        let args = parse_fn_args(quote! { fn f(x: u32) {} });
        crate::utils::expect_env_param(&args);
    });
}

// ============================================
// EnvParam::as_ref_tokens Tests
// ============================================

#[test]
fn test_as_ref_tokens_for_owned_env_adds_ampersand() {
    let args = parse_fn_args(quote! { fn f(env: Env) {} });
    let param = crate::utils::find_env_param(&args).unwrap();
    let tokens = param.as_ref_tokens();
    // For owned Env, as_ref_tokens should produce `&env`
    assert_eq!(tokens.to_string(), "& env");
}

#[test]
fn test_as_ref_tokens_for_ref_env_no_ampersand() {
    let args = parse_fn_args(quote! { fn f(env: &Env) {} });
    let param = crate::utils::find_env_param(&args).unwrap();
    let tokens = param.as_ref_tokens();
    // For reference Env, as_ref_tokens should produce `env` (no extra &)
    assert_eq!(tokens.to_string(), "env");
}

#[test]
fn test_as_ref_tokens_for_custom_named_owned_env() {
    let args = parse_fn_args(quote! { fn f(my_environment: Env) {} });
    let param = crate::utils::find_env_param(&args).unwrap();
    let tokens = param.as_ref_tokens();
    assert_eq!(tokens.to_string(), "& my_environment");
}

#[test]
fn test_as_ref_tokens_for_custom_named_ref_env() {
    let args = parse_fn_args(quote! { fn f(my_environment: &Env) {} });
    let param = crate::utils::find_env_param(&args).unwrap();
    let tokens = param.as_ref_tokens();
    assert_eq!(tokens.to_string(), "my_environment");
}

// ============================================
// is_env_type Tests (comprehensive coverage)
// ============================================

#[test]
fn test_is_env_type_recognizes_env_types() {
    let env_types = [
        "Env",
        "&Env",
        "&&Env",
        "&mut Env",
        "soroban_sdk::Env",
        "&soroban_sdk::Env",
        "some::deeply::nested::module::Env",
    ];

    for ty_str in env_types {
        let ty = syn::parse_str::<syn::Type>(ty_str).expect("failed to parse type");
        assert!(crate::utils::is_env_type(&ty), "{ty_str} should be recognized as an Env type");
    }
}

#[test]
fn test_is_env_type_rejects_non_env_types() {
    let non_env_types = ["u32", "bool", "String", "Address", "&u32", "soroban_sdk::Address", "Environment"];

    for ty_str in non_env_types {
        let ty = syn::parse_str::<syn::Type>(ty_str).expect("failed to parse type");
        assert!(!crate::utils::is_env_type(&ty), "{ty_str} should NOT be recognized as an Env type");
    }
}

#[test]
fn test_is_env_type_rejects_other_type_variants() {
    let other_variants = [
        ("(Env, u32)", "tuple"),
        ("[Env; 1]", "array"),
        ("[Env]", "slice"),
        ("Option<Env>", "generic"),
        ("!", "never"),
        ("fn() -> Env", "fn pointer"),
    ];

    for (ty_str, label) in other_variants {
        let ty = syn::parse_str::<syn::Type>(ty_str).expect("failed to parse type");
        assert!(!crate::utils::is_env_type(&ty), "{label} type {ty_str} should NOT be recognized as an Env type");
    }
}
