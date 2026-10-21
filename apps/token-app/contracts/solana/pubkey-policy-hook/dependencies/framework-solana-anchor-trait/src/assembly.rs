//! Final assembly of generated code into the macro output.

use proc_macro2::{Ident, TokenStream};
use quote::quote;
use syn::{AttrStyle, ItemMod};

use crate::{generation::GeneratedInstructions, overrides::InstructionOverrides, InstructionSet};

/// Input for the final assembly step.
pub struct Assembly<Ix: InstructionSet> {
    /// Token stream emitted before the module (e.g. default state structs, role events).
    pub prelude: TokenStream,
    /// The collected overrides (provides wrapper defs and item filtering).
    pub overrides: InstructionOverrides<Ix>,
    /// The generated instruction code.
    pub instructions: GeneratedInstructions,
    /// Extra attributes placed on the module (e.g. `#[rbac(...)]`).
    pub extra_mod_attrs: TokenStream,
    /// The original module being transformed.
    pub source_mod: ItemMod,
    /// Name of the `macro_rules!` for extending default accounts structs.
    /// `None` if the domain has no provided instructions.
    pub extend_macro_name: Option<Ident>,
}

impl<Ix: InstructionSet> Assembly<Ix> {
    /// Assembles the final macro output from all generated parts.
    ///
    /// `#[program]` is always emitted as the innermost attribute on the module so
    /// that Anchor expands last — after all instruction macros have injected their
    /// code. Any outer module attribute whose last path segment is `program` is
    /// stripped and re-emitted at the correct position; this catches qualified
    /// forms like `#[anchor_lang::program]` and leaves inner `#![…program]`
    /// untouched. This keeps stacking order irrelevant for any combination of
    /// domain macros (e.g. `#[oapp]` + `#[composer]`).
    ///
    /// ```text
    /// prelude              // domain-specific definitions (state types, events, etc.)
    /// default_impls        // generated default accounts structs + handler impls
    /// extend_macro         // macro_rules! for extending default accounts (if configured)
    /// #[outer_mod_attrs]   // outer attrs from the source module
    /// #[extra_mod_attrs]   // e.g. #[rbac(...)]
    /// #[program]           // always innermost — auto-managed by Assembly
    /// mod name {
    ///     #![inner_mod_attrs]  // inner attrs from the source module (e.g. #![deny(...)])
    ///     filtered_items   // original items minus relocated handlers
    ///     wrapper_defs     // relocated override handler modules — kept inside so handlers
    ///                      //   can reach the user's nested same-module helpers
    ///     entrypoints      // generated instruction entrypoints
    /// }
    /// ```
    pub fn assemble(self) -> TokenStream {
        let Self {
            prelude,
            overrides,
            instructions,
            extra_mod_attrs,
            source_mod,
            extend_macro_name,
        } = self;

        let wrapper_defs = &overrides.wrapper_defs;
        let filtered_items = overrides.filtered_items(&source_mod);
        let GeneratedInstructions { default_impls, entrypoints, extend_rules } = &instructions;

        // If there are extend rules, emit a macro_rules! with the given name.
        let extend_macro = match extend_macro_name {
            Some(name) if !extend_rules.is_empty() => quote! {
                #[allow(unused_macros)]
                macro_rules! #name {
                    #extend_rules
                }
            },
            _ => TokenStream::new(),
        };

        let ItemMod { attrs: mod_attrs, vis: mod_vis, ident: mod_ident, .. } = &source_mod;

        // Partition first: only outer `#[...program]` attrs are framework-owned and re-emitted
        // below. Inner attrs (`#![...]`, `//!`) must stay inside the module body unchanged.
        let (inner_attrs, outer_attrs): (Vec<_>, Vec<_>) =
            mod_attrs.iter().partition(|a| matches!(a.style, AttrStyle::Inner(_)));
        let outer_attrs: Vec<_> = outer_attrs
            .into_iter()
            .filter(|a| a.path().segments.last().is_none_or(|s| s.ident != "program"))
            .collect();

        quote! {
            #prelude
            #default_impls
            #extend_macro

            #(#outer_attrs)*
            #extra_mod_attrs
            #[program]
            #mod_vis mod #mod_ident {
                #(#inner_attrs)*
                use super::*;
                #filtered_items
                #wrapper_defs
                #entrypoints
            }
        }
    }
}
