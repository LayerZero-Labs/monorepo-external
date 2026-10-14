//! Shared test fixtures and helpers for anchor-trait integration tests.

#![allow(dead_code)]

use anchor_trait::{
    generate_instructions, DefaultAccounts, DefaultImpl, GeneratedInstructions,
    InstructionOverrides, InstructionSet, InstructionSpec, OverrideConfig,
};
use proc_macro2::TokenStream;
use quote::{format_ident, quote, ToTokens};
use syn::{
    parse_quote, FnArg, GenericArgument, ItemFn, ItemStruct, Pat, PatIdent, PathArguments, Type,
};

// ---------------------------------------------------------------------------
// Test instruction set
// ---------------------------------------------------------------------------

/// Instruction set shared across generation and assembly tests.
///
/// - SetPeer: mutable, has params, has default impl (provided)
/// - GetPeer: view, has params, has default impl (provided)
/// - LzReceive: mutable, has params, NO default impl (required)
/// - Token: view, NO params, has default impl (provided)
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum TestIx {
    SetPeer,
    GetPeer,
    LzReceive,
    Token,
}

/// Dummy codegen context.
pub struct TestCtx;

fn gen_set_peer(_ctx: &TestCtx, spec: &InstructionSpec<TestCtx>) -> DefaultAccounts {
    let handler_ident = &spec.default_impl.as_ref().unwrap().handler_ident;
    let params_type = spec.params_type.as_ref().unwrap();
    let return_type = &spec.return_type;
    DefaultAccounts {
        struct_type: parse_quote! {
            #[derive(Accounts)]
            pub struct StdSetPeer<'info> {
                pub placeholder: UncheckedAccount<'info>,
            }
        },
        impl_block: parse_quote! {
            impl StdSetPeer<'_> {
                pub fn #handler_ident(_ctx: &mut Context<Self>, _params: &#params_type) -> Result<#return_type> {
                    unimplemented!()
                }
            }
        },
    }
}

fn gen_get_peer(_ctx: &TestCtx, spec: &InstructionSpec<TestCtx>) -> DefaultAccounts {
    let handler_ident = &spec.default_impl.as_ref().unwrap().handler_ident;
    let params_type = spec.params_type.as_ref().unwrap();
    let return_type = &spec.return_type;
    DefaultAccounts {
        struct_type: parse_quote! {
            #[derive(Accounts)]
            pub struct StdGetPeer<'info> {
                pub placeholder: UncheckedAccount<'info>,
            }
        },
        impl_block: parse_quote! {
            impl StdGetPeer<'_> {
                pub fn #handler_ident(_ctx: &Context<Self>, _params: &#params_type) -> Result<#return_type> {
                    unimplemented!()
                }
            }
        },
    }
}

fn gen_token(_ctx: &TestCtx, spec: &InstructionSpec<TestCtx>) -> DefaultAccounts {
    let handler_ident = &spec.default_impl.as_ref().unwrap().handler_ident;
    let return_type = &spec.return_type;
    DefaultAccounts {
        struct_type: parse_quote! {
            #[derive(Accounts)]
            pub struct StdToken<'info> {
                pub placeholder: UncheckedAccount<'info>,
            }
        },
        impl_block: parse_quote! {
            impl StdToken<'_> {
                pub fn #handler_ident(_ctx: &Context<Self>) -> Result<#return_type> {
                    unimplemented!()
                }
            }
        },
    }
}

impl InstructionSet for TestIx {
    type Ctx = TestCtx;

    fn all() -> &'static [Self] {
        &[Self::SetPeer, Self::GetPeer, Self::LzReceive, Self::Token]
    }

    fn from_ident(ident: &syn::Ident) -> Option<Self> {
        match ident.to_string().as_str() {
            "set_peer" => Some(Self::SetPeer),
            "get_peer" => Some(Self::GetPeer),
            "lz_receive" => Some(Self::LzReceive),
            "token" => Some(Self::Token),
            _ => None,
        }
    }

    fn canonical_name(&self) -> &'static str {
        match self {
            Self::SetPeer => "set_peer",
            Self::GetPeer => "get_peer",
            Self::LzReceive => "lz_receive",
            Self::Token => "token",
        }
    }

    fn spec(self, _ctx: &Self::Ctx) -> InstructionSpec<TestCtx> {
        match self {
            Self::SetPeer => InstructionSpec {
                params_type: Some(quote!(SetPeerParams)),
                return_type: quote!(()),
                is_view: false,
                default_impl: Some(DefaultImpl {
                    handler_ident: format_ident!("apply"),
                    generator: gen_set_peer,
                }),
            },
            Self::GetPeer => InstructionSpec {
                params_type: Some(quote!(GetPeerParams)),
                return_type: quote!([u8; 32]),
                is_view: true,
                default_impl: Some(DefaultImpl {
                    handler_ident: format_ident!("apply"),
                    generator: gen_get_peer,
                }),
            },
            Self::LzReceive => InstructionSpec {
                params_type: Some(quote!(LzReceiveParams)),
                return_type: quote!(()),
                is_view: false,
                default_impl: None, // required — no default
            },
            Self::Token => InstructionSpec {
                params_type: None, // no params
                return_type: quote!(Pubkey),
                is_view: true,
                default_impl: Some(DefaultImpl {
                    handler_ident: format_ident!("apply"),
                    generator: gen_token,
                }),
            },
        }
    }
}

pub const TEST_CONFIG: OverrideConfig =
    OverrideConfig { attr_name: "test_instruction", domain: "Test" };

// ---------------------------------------------------------------------------
// Pipeline helpers
// ---------------------------------------------------------------------------

/// Collect overrides from a module and run generation.
pub fn generate_ok(module: &syn::ItemMod) -> GeneratedInstructions {
    let overrides = InstructionOverrides::<TestIx>::collect(module, TEST_CONFIG)
        .expect("collect() should succeed");
    generate_instructions(&TestCtx, &overrides).expect("generate should succeed")
}

/// Collect overrides and expect generation to fail.
pub fn generate_err(module: &syn::ItemMod) -> String {
    let overrides = InstructionOverrides::<TestIx>::collect(module, TEST_CONFIG)
        .expect("collect() should succeed");
    match generate_instructions(&TestCtx, &overrides) {
        Err(e) => e.to_string(),
        Ok(_) => panic!("generate should have failed but succeeded"),
    }
}

/// Collect overrides from a module (for assembly tests that need the overrides directly).
pub fn collect_overrides(module: &syn::ItemMod) -> InstructionOverrides<TestIx> {
    InstructionOverrides::<TestIx>::collect(module, TEST_CONFIG).expect("collect() should succeed")
}

// ---------------------------------------------------------------------------
// AST assertion helpers
// ---------------------------------------------------------------------------

/// Parse a token stream and extract all function items.
pub fn parse_fns(ts: &TokenStream) -> Vec<ItemFn> {
    let file: syn::File = syn::parse2(quote! { #ts }).expect("should parse as File");
    file.items
        .into_iter()
        .filter_map(|item| match item {
            syn::Item::Fn(f) => Some(f),
            _ => None,
        })
        .collect()
}

/// Parse a token stream and extract all struct items.
pub fn parse_structs(ts: &TokenStream) -> Vec<ItemStruct> {
    let file: syn::File = syn::parse2(quote! { #ts }).expect("should parse as File");
    file.items
        .into_iter()
        .filter_map(|item| match item {
            syn::Item::Struct(s) => Some(s),
            _ => None,
        })
        .collect()
}

/// Find a function by name in a list of parsed functions.
pub fn find_fn<'a>(fns: &'a [ItemFn], name: &str) -> Option<&'a ItemFn> {
    fns.iter().find(|f| f.sig.ident == name)
}

/// Find a struct by name in a list of parsed structs.
pub fn find_struct<'a>(structs: &'a [ItemStruct], name: &str) -> Option<&'a ItemStruct> {
    structs.iter().find(|s| s.ident == name)
}

/// Extract (is_mut, context_inner_type) from the first parameter of a function.
/// Expects the first param to be `ctx: Context<T>` or `mut ctx: Context<T>`.
pub fn first_param_context_type(f: &ItemFn) -> (bool, String) {
    let arg = f.sig.inputs.first().expect("function should have at least one param");

    let FnArg::Typed(pat_type) = arg else {
        panic!("expected typed param, got self");
    };

    // Check mutability from the pattern (mut ctx vs ctx)
    let is_mut = match pat_type.pat.as_ref() {
        Pat::Ident(PatIdent { mutability, .. }) => mutability.is_some(),
        other => panic!("expected ident pattern, got: {}", other.to_token_stream()),
    };

    // Extract the inner type T from Context<T> (or Context<'a, 'b, ..., T>)
    let Type::Path(type_path) = pat_type.ty.as_ref() else {
        panic!("expected path type for ctx param");
    };
    let segment = type_path.path.segments.last().expect("empty path");
    assert_eq!(segment.ident, "Context", "first param should be Context<T>");
    let PathArguments::AngleBracketed(args) = &segment.arguments else {
        panic!("Context should have angle bracket args");
    };
    let inner = args.args.last().expect("Context should have at least one type arg");
    let GenericArgument::Type(inner_type) = inner else {
        panic!("last generic arg should be a type");
    };

    (is_mut, inner_type.to_token_stream().to_string())
}
