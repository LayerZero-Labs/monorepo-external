use quote::quote;

// ============================================
// Unit Tests: #[oapp(custom = [...])] parsing
// ============================================

#[test]
fn test_custom_impls_parse_empty_is_default() {
    let parsed: crate::generators::CustomImpls = syn::parse2(quote! {}).expect("failed to parse empty attrs");
    assert!(!parsed.core);
    assert!(!parsed.sender);
    assert!(!parsed.receiver);
    assert!(!parsed.options_type3);
}

#[test]
fn test_custom_impls_parse_valid_all_list() {
    let parsed: crate::generators::CustomImpls =
        syn::parse2(quote! { custom = [core, sender, receiver, options_type3] }).expect("failed to parse attrs");
    assert!(parsed.core);
    assert!(parsed.sender);
    assert!(parsed.receiver);
    assert!(parsed.options_type3);
}

#[test]
fn test_custom_impls_parse_empty_custom_list_is_default() {
    let parsed: crate::generators::CustomImpls = syn::parse2(quote! { custom = [] }).expect("failed to parse attrs");
    assert!(!parsed.core);
    assert!(!parsed.sender);
    assert!(!parsed.receiver);
    assert!(!parsed.options_type3);
}

#[test]
fn test_custom_impls_allows_trailing_comma() {
    let parsed: crate::generators::CustomImpls =
        syn::parse2(quote! { custom = [core,] }).expect("failed to parse attrs");
    assert!(parsed.core);
    assert!(!parsed.sender);
    assert!(!parsed.receiver);
    assert!(!parsed.options_type3);
}

#[test]
fn test_custom_impls_allows_duplicates() {
    // Duplicates are harmless and should not cause parsing to fail.
    let parsed: crate::generators::CustomImpls =
        syn::parse2(quote! { custom = [core, core, receiver, receiver] }).expect("failed to parse attrs");
    assert!(parsed.core);
    assert!(!parsed.sender);
    assert!(parsed.receiver);
    assert!(!parsed.options_type3);
}

#[test]
fn test_custom_impls_rejects_wrong_key() {
    let err =
        syn::parse2::<crate::generators::CustomImpls>(quote! { nope = [core] }).expect_err("expected parse failure");
    assert!(err.to_string().contains("expected `custom`"), "unexpected error: {err}");
}

#[test]
fn test_custom_impls_rejects_unknown_ident() {
    let err = syn::parse2::<crate::generators::CustomImpls>(quote! { custom = [core, not_a_real_option] })
        .expect_err("expected failure");
    assert!(
        err.to_string().contains("expected one of `core`, `sender`, `receiver`, `options_type3`"),
        "unexpected error: {err}"
    );
}

#[test]
fn test_custom_impls_rejects_trailing_tokens_after_list() {
    // `syn::parse2` expects the parser to consume the full stream.
    syn::parse2::<crate::generators::CustomImpls>(quote! { custom = [core] extra })
        .expect_err("expected parse failure due to trailing tokens");
}

#[test]
fn test_custom_impls_rejects_missing_equals() {
    syn::parse2::<crate::generators::CustomImpls>(quote! { custom [core] })
        .expect_err("expected parse failure (missing `=`)");
}

#[test]
fn test_custom_impls_rejects_non_bracketed_list() {
    syn::parse2::<crate::generators::CustomImpls>(quote! { custom = (core) })
        .expect_err("expected parse failure (not `[...]`)");
}
