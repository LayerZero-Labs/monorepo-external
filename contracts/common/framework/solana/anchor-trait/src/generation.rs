//! Instruction code generation with override level resolution.
//!
//! - **Default**: No override → emit default impl + default entrypoint.
//! - **Override**: Custom handler present → emit default impl (always available), entrypoint
//!   dispatches to implementor's handler using whatever context type the handler declares.

use proc_macro2::{Ident, Span, TokenStream};
use quote::{quote, ToTokens};
use syn::{ItemImpl, ItemStruct};

use crate::{overrides::InstructionOverrides, InstructionSet};

/// Descriptor for one instruction's code generation.
pub struct InstructionSpec<Ctx> {
    /// Parameter type as a token stream (e.g. `Some(quote!(::oapp::types::SetPeerParams))`).
    /// Use `None` for instructions with no params.
    pub params_type: Option<TokenStream>,
    /// Return type as a token stream (e.g. `quote!(())` or `quote!([u8; 32])`).
    pub return_type: TokenStream,
    /// When `true`, the entrypoint passes `&ctx` (immutable).
    /// When `false`, it passes `&mut ctx`.
    pub is_view: bool,
    /// - `Some(...)` — provided instruction (Default and Override levels valid).
    /// - `None` — **required** instruction: the implementor must provide an override handler.
    ///   Omitting the override produces a compile error.
    pub default_impl: Option<DefaultImpl<Ctx>>,
}

/// Default impl generation for an instruction (accounts struct + handler).
///
/// Groups the fields that are only meaningful when an instruction
/// has a framework-provided default implementation.
pub struct DefaultImpl<Ctx> {
    /// Name of the default handler method on the context struct, e.g. `format_ident!("apply")`.
    /// At the Default level, the entrypoint calls `StdAccounts::<this>(...)`.
    pub handler_ident: Ident,
    /// Returns the complete accounts struct and its impl block as typed AST.
    pub generator: fn(&Ctx, &InstructionSpec<Ctx>) -> DefaultAccounts,
}

/// Complete accounts struct and its handler impl block.
///
/// Produces two outputs: the concrete struct + impl via [`to_definition`](Self::to_definition),
/// and a `macro_rules!` rule via [`to_extend_rule`](Self::to_extend_rule) (which reconstructs
/// the type as `pub struct $name<'info>` / `impl $name<'_>`).
///
/// **Constraint:** `struct_type` must carry exactly `'info` — no type or const generics.
/// Extra generics are silently dropped by both codegen paths, surfacing as type errors at
/// the extend-macro call site.
pub struct DefaultAccounts {
    /// Complete struct definition including attributes, name, generics, and fields.
    pub struct_type: ItemStruct,
    /// Complete impl block with handler methods. Must use `Context<Self>` so the
    /// methods work regardless of the struct name.
    pub impl_block: ItemImpl,
}

impl DefaultAccounts {
    /// Returns the struct ident (e.g. `StdSetPeer`) — the single source of truth.
    pub fn accounts_ident(&self) -> &Ident {
        &self.struct_type.ident
    }

    /// Emits the struct and impl block.
    pub fn to_definition(&self) -> TokenStream {
        let s = &self.struct_type;
        let i = &self.impl_block;
        quote! { #s #i }
    }

    /// Assembles one `macro_rules!` rule for extending the default accounts.
    ///
    /// Decomposes the struct into attributes and fields, then re-emits with
    /// `$name` replacing the struct ident and `$($extra)*` appended to the fields.
    pub fn to_extend_rule(&self, instruction_name: &str) -> TokenStream {
        let attrs = &self.struct_type.attrs;
        let fields: Vec<_> = match &self.struct_type.fields {
            syn::Fields::Named(f) => f.named.iter().collect(),
            _ => unreachable!("accounts structs always have named fields"),
        };
        let impl_items = &self.impl_block.items;
        let rule_ident = Ident::new(instruction_name, Span::call_site());

        quote! {
            (#rule_ident, $name:ident, { $($extra:tt)* }) => {
                #(#attrs)*
                pub struct $name<'info> {
                    #(#fields,)*
                    $($extra)*
                }

                impl $name<'_> {
                    #(#impl_items)*
                }
            };
        }
    }
}

/// Accumulated output from instruction generation.
#[derive(Default)]
pub struct GeneratedInstructions {
    /// All default impl definitions (accounts struct + handler), placed outside the program
    /// module.
    pub default_impls: TokenStream,
    /// All entrypoint function definitions (placed inside the program module).
    pub entrypoints: TokenStream,
    /// Collected `macro_rules!` rules for extending default accounts structs.
    pub extend_rules: TokenStream,
}

impl GeneratedInstructions {
    fn extend(&mut self, other: Self) {
        self.default_impls.extend(other.default_impls);
        self.entrypoints.extend(other.entrypoints);
        self.extend_rules.extend(other.extend_rules);
    }
}

/// Generates code for all instructions and merges into a single output.
pub fn generate_instructions<Ix: InstructionSet>(
    ctx: &Ix::Ctx,
    overrides: &InstructionOverrides<Ix>,
) -> syn::Result<GeneratedInstructions> {
    let mut out = GeneratedInstructions::default();
    for &ix in Ix::all() {
        out.extend(generate_instruction(ix, ctx, overrides)?);
    }
    Ok(out)
}

/// Generates code for a single instruction.
///
/// Returns `Err` if the instruction is required (`default_impl = None`)
/// and the implementor did not provide an override handler.
fn generate_instruction<Ix: InstructionSet>(
    ix_name: Ix,
    ctx: &Ix::Ctx,
    overrides: &InstructionOverrides<Ix>,
) -> syn::Result<GeneratedInstructions> {
    let spec = ix_name.spec(ctx);
    let handler = overrides.get(ix_name);

    // Required instruction with no override → compile error.
    if handler.is_none() && spec.default_impl.is_none() {
        return Err(syn::Error::new(
            Span::call_site(),
            format!(
                "instruction `{}` has no default implementation; \
                provide a `fn {}(...)` annotated with #[{}]",
                ix_name.canonical_name(),
                ix_name.canonical_name(),
                &overrides.config.attr_name,
            ),
        ));
    }

    // Always emit the default accounts when one exists (available even under override).
    // Also collect the extend rule for the macro_rules! arm.
    let default_accounts = spec.default_impl.as_ref().map(|d| (d.generator)(ctx, &spec));
    let (default_impls, extend_rules) = match &default_accounts {
        Some(da) => (da.to_definition(), da.to_extend_rule(ix_name.canonical_name())),
        None => (TokenStream::new(), TokenStream::new()),
    };

    // Assemble entrypoint fragments from spec + dispatch target.
    let entry_fn_ident = syn::Ident::new(ix_name.canonical_name(), Span::call_site());

    // Resolve dispatch target: override handler vs default handler.
    let (fn_generics, context_type, dispatch) = match handler {
        Some(h) => {
            let wrapper = &h.wrapper_mod;
            let ctx_type = &h.context_type;
            (h.fn_generics.to_token_stream(), quote!(#ctx_type), quote!(#wrapper::#entry_fn_ident))
        },
        None => {
            let default = spec.default_impl.as_ref().expect("validated above");
            let accounts = default_accounts.as_ref().unwrap().accounts_ident();
            let handler_fn = &default.handler_ident;
            (TokenStream::new(), quote!(Context<#accounts>), quote!(#accounts::#handler_fn))
        },
    };
    let return_type = &spec.return_type;
    let (ref_token, ctx_decl) = if spec.is_view {
        (quote!(&), quote!(ctx: #context_type))
    } else {
        (quote!(&mut), quote!(mut ctx: #context_type))
    };

    // Emit the entrypoint function, with or without a params argument.
    let entrypoints = match &spec.params_type {
        Some(params_type) => quote! {
            pub fn #entry_fn_ident #fn_generics (#ctx_decl, params: #params_type) -> ::anchor_lang::Result<#return_type> {
                #dispatch(#ref_token ctx, &params)
            }
        },
        None => quote! {
            pub fn #entry_fn_ident #fn_generics (#ctx_decl) -> ::anchor_lang::Result<#return_type> {
                #dispatch(#ref_token ctx)
            }
        },
    };

    Ok(GeneratedInstructions { default_impls, entrypoints, extend_rules })
}
