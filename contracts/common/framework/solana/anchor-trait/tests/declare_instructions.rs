//! Tests for the `declare_instructions!` macro.

use anchor_trait::{InstructionSet, InstructionSpec};
use quote::quote;

// ---------------------------------------------------------------------------
// Test fixtures — fake modules that declare_instructions! dispatches to
// ---------------------------------------------------------------------------

struct TestCtx;

/// Module with ctx-passing spec (the `(ctx)` marker form).
mod alpha {
    use super::*;

    pub fn spec(_ctx: &TestCtx) -> InstructionSpec<TestCtx> {
        InstructionSpec {
            params_type: Some(quote!(AlphaParams)),
            return_type: quote!(()),
            is_view: false,
            default_impl: None,
        }
    }
}

/// Module with no-ctx spec (no marker form).
mod beta {
    use super::*;

    pub fn spec() -> InstructionSpec<TestCtx> {
        InstructionSpec {
            params_type: None,
            return_type: quote!(u64),
            is_view: true,
            default_impl: None,
        }
    }
}

/// Third module to test with more than two variants.
mod gamma {
    use super::*;

    pub fn spec(ctx: &TestCtx) -> InstructionSpec<TestCtx> {
        let _ = ctx;
        InstructionSpec {
            params_type: Some(quote!(GammaParams)),
            return_type: quote!(bool),
            is_view: false,
            default_impl: None,
        }
    }
}

// ---------------------------------------------------------------------------
// Primary invocation — mixed ctx/no-ctx, trailing comma, multiple variants
// ---------------------------------------------------------------------------

anchor_trait::declare_instructions! {
    name = TestIx;
    context = TestCtx;

    Alpha => alpha(ctx),
    Beta  => beta,
    Gamma => gamma(ctx),
}

// ---------------------------------------------------------------------------
// Compile-time grammar guards
//
// These modules exist solely to prove that the macro accepts certain grammar
// variants. If any of these stops compiling, a future change broke the macro's
// accepted syntax. No runtime assertions needed — compilation is the test.
// ---------------------------------------------------------------------------

/// Single-variant invocation. Guards the `)+` (one-or-more) boundary.
mod single_variant {
    use super::*;

    anchor_trait::declare_instructions! {
        name = SingleIx;
        context = TestCtx;

        Alpha => alpha(ctx),
    }
}

/// No trailing comma. Guards the optional `$(,)?` at the end.
mod no_trailing_comma {
    use super::*;

    anchor_trait::declare_instructions! {
        name = NoCommaIx;
        context = TestCtx;

        Alpha => alpha(ctx),
        Beta  => beta
    }
}

/// All variants use the `(ctx)` marker. Guards that the ctx-passing path
/// works without any no-ctx variants present.
mod all_ctx {
    use super::*;

    anchor_trait::declare_instructions! {
        name = AllCtxIx;
        context = TestCtx;

        Alpha => alpha(ctx),
        Gamma => gamma(ctx),
    }
}

/// No variants use the `(ctx)` marker. Guards that the no-ctx path works
/// without any ctx-passing variants present.
mod all_no_ctx {
    use super::*;

    anchor_trait::declare_instructions! {
        name = AllNoCtxIx;
        context = TestCtx;

        Beta => beta,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn all_returns_variants_in_declaration_order() {
    let all = TestIx::all();
    assert_eq!(all.len(), 3);
    assert_eq!(all[0], TestIx::Alpha);
    assert_eq!(all[1], TestIx::Beta);
    assert_eq!(all[2], TestIx::Gamma);
}

#[test]
fn from_ident_maps_canonical_names() {
    let alpha_ident = syn::Ident::new("alpha", proc_macro2::Span::call_site());
    let beta_ident = syn::Ident::new("beta", proc_macro2::Span::call_site());
    let gamma_ident = syn::Ident::new("gamma", proc_macro2::Span::call_site());

    assert_eq!(TestIx::from_ident(&alpha_ident), Some(TestIx::Alpha));
    assert_eq!(TestIx::from_ident(&beta_ident), Some(TestIx::Beta));
    assert_eq!(TestIx::from_ident(&gamma_ident), Some(TestIx::Gamma));
}

#[test]
fn from_ident_returns_none_for_unknown() {
    let unknown = syn::Ident::new("nonexistent", proc_macro2::Span::call_site());
    assert_eq!(TestIx::from_ident(&unknown), None);
}

#[test]
fn canonical_name_returns_module_name() {
    assert_eq!(TestIx::Alpha.canonical_name(), "alpha");
    assert_eq!(TestIx::Beta.canonical_name(), "beta");
    assert_eq!(TestIx::Gamma.canonical_name(), "gamma");
}

#[test]
fn from_ident_and_canonical_name_are_inverses() {
    for &variant in TestIx::all() {
        let name = variant.canonical_name();
        let ident = syn::Ident::new(name, proc_macro2::Span::call_site());
        assert_eq!(TestIx::from_ident(&ident), Some(variant), "round-trip failed for {name}");
    }
}

#[test]
fn spec_dispatches_with_ctx_marker() {
    let ctx = TestCtx;
    let spec = TestIx::Alpha.spec(&ctx);

    // Alpha uses (ctx) marker → alpha::spec(&ctx)
    assert!(!spec.is_view, "alpha should be mutable");
    assert_eq!(spec.params_type.unwrap().to_string(), quote!(AlphaParams).to_string());
}

#[test]
fn spec_dispatches_without_ctx_marker() {
    let ctx = TestCtx;
    let spec = TestIx::Beta.spec(&ctx);

    // Beta has no ctx marker → beta::spec() (ctx not passed)
    assert!(spec.is_view, "beta should be a view");
    assert!(spec.params_type.is_none(), "beta should have no params");
    assert_eq!(spec.return_type.to_string(), quote!(u64).to_string());
}

#[test]
fn ord_matches_declaration_order() {
    // The macro derives Ord. Enum discriminant order = declaration order,
    // so Alpha < Beta < Gamma must hold.
    assert!(TestIx::Alpha < TestIx::Beta);
    assert!(TestIx::Beta < TestIx::Gamma);

    // Also verify via sort: sorting should be a no-op on all()
    let mut sorted = TestIx::all().to_vec();
    sorted.sort();
    assert_eq!(sorted, TestIx::all());
}
