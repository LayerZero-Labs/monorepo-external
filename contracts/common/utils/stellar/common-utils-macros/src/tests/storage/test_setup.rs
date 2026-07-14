//! Shared helpers for storage macro unit tests.
//!
//! Keep these helpers scoped to the storage test module to avoid leaking
//! test-only utilities across the crate.
/// Parse the first `syn::Variant` from a single-variant `enum` token stream.
pub(in crate::tests::storage) fn parse_variant(input: proc_macro2::TokenStream) -> syn::Variant {
    let item_enum: syn::ItemEnum = syn::parse2(input).expect("failed to parse enum");
    item_enum.variants.into_iter().next().expect("no variant found")
}

/// Parse the attributes from the first variant in a single-variant `enum` token stream.
pub(in crate::tests::storage) fn parse_attrs(input: proc_macro2::TokenStream) -> Vec<syn::Attribute> {
    let item_enum: syn::ItemEnum = syn::parse2(input).expect("failed to parse enum");
    item_enum.variants.into_iter().next().expect("no variant found").attrs
}

/// Normalize whitespace in a `TokenStream` for stable string comparisons.
pub(in crate::tests::storage) fn normalize(ts: proc_macro2::TokenStream) -> String {
    ts.to_string().split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Convenience for tests building input via `format!(...)`.
pub(in crate::tests::storage) fn parse_variant_str(input: &str) -> syn::Variant {
    parse_variant(input.parse().expect("failed to parse token stream"))
}
