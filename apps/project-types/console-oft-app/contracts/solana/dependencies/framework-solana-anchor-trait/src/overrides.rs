//! Instruction override collection and validation.
//!
//! Discovers `#[*_instruction]` handlers inside a module, validates them,
//! relocates them into wrapper modules, and provides filtered module items for
//! final assembly.

use itertools::Itertools;
use proc_macro2::TokenStream;
use quote::{format_ident, quote};
use std::collections::BTreeMap;
use syn::{Attribute, Item, ItemFn, ItemMod, Type};

use crate::InstructionSet;

/// Static configuration for a macro crate's instruction override system.
#[derive(Debug, Clone, Copy)]
pub struct OverrideConfig {
    /// Attribute name used to mark override handlers, e.g. `"oapp_instruction"`.
    pub attr_name: &'static str,
    /// Human-readable domain label for diagnostics, e.g. `"OApp"` or `"RBAC"`.
    pub domain: &'static str,
}

/// Metadata captured for one overridden handler function.
pub struct HandlerMeta {
    /// Wrapper module identifier for the relocated handler.
    pub wrapper_mod: syn::Ident,
    /// The full `Context<...>` type as written (preserves lifetime args).
    pub context_type: Type,
    /// Function-level generics (e.g. `<'info>`) from the override handler.
    pub fn_generics: syn::Generics,
}

/// Collection of custom instruction handlers discovered from a module.
pub struct InstructionOverrides<Ix: InstructionSet> {
    /// Map of instruction variants to their handler metadata.
    handlers: BTreeMap<Ix, HandlerMeta>,
    /// Token stream containing all generated wrapper module definitions.
    pub wrapper_defs: TokenStream,
    /// Configuration for the override system (attribute name, domain label).
    pub config: OverrideConfig,
}

impl<Ix: InstructionSet> InstructionOverrides<Ix> {
    /// Creates an empty override collection with the given config.
    fn new(config: OverrideConfig) -> Self {
        Self { handlers: BTreeMap::new(), wrapper_defs: TokenStream::new(), config }
    }

    /// Scans a module for `#[<attr>(...)]` handlers and builds the override collection.
    pub fn collect(module: &ItemMod, config: OverrideConfig) -> syn::Result<Self> {
        let mut collected = Self::new(config);

        // Extract the module content and early return if it's empty.
        let items = match &module.content {
            Some((_, items)) => items,
            None => return Ok(collected),
        };

        // Walk every function in the module looking for override attributes.
        for item in items {
            // Only process functions that are annotated with the override attribute.
            let Item::Fn(fn_item) = item else { continue };
            let Some(target) = parse_override_target::<Ix>(fn_item, config)? else {
                continue;
            };

            // Reject duplicate overrides for the same instruction.
            if collected.handlers.contains_key(&target) {
                return Err(syn::Error::new_spanned(
                    &fn_item.sig.ident,
                    format!(
                        "duplicate #[{}] for instruction `{}` is not allowed",
                        config.attr_name,
                        target.canonical_name(),
                    ),
                ));
            }

            // Relocate the handler into a wrapper module and record its metadata.
            let meta = collected.wrap_handler(target, fn_item)?;
            collected.handlers.insert(target, meta);
        }

        // Ensure no unannotated `fn name()` accidentally shadows a known instruction name.
        collected.reject_name_collisions(items)?;
        Ok(collected)
    }

    /// Returns metadata for an overridden instruction, if present.
    pub fn get(&self, target: Ix) -> Option<&HandlerMeta> {
        self.handlers.get(&target)
    }

    /// Returns module items with relocated override handlers removed.
    pub fn filtered_items(&self, module: &ItemMod) -> TokenStream {
        let Some((_, items)) = &module.content else {
            return TokenStream::new();
        };

        // Filter out functions that are overridden.
        let kept: Vec<_> = items
            .iter()
            .filter(|item| match item {
                Item::Fn(fn_item) => !has_override_attr(fn_item, self.config),
                _ => true,
            })
            .collect();

        quote!(#(#kept)*)
    }

    /// Wraps a handler fn in a generated module
    /// (`mod __<attr>__<instr>_handler { use super::*; ... }`) and returns
    /// its [`HandlerMeta`]. The override attribute (e.g. `#[oapp_instruction]`)
    /// is stripped; other attributes ride along on the cloned fn.
    ///
    /// Each attribute expands inside the wrapper module rather than at the
    /// fn's original location, so any code it generates is inserted there
    /// and resolves names against the wrapper's scope (which reaches the
    /// parent via `use super::*;`).
    fn wrap_handler(&mut self, target: Ix, fn_item: &ItemFn) -> syn::Result<HandlerMeta> {
        let context_type = infer_context_type(fn_item)?;
        let fn_generics = fn_item.sig.generics.clone();

        // Generate a deterministic module name: `__<attr>__<instruction>_handler`.
        let wrapper_mod =
            format_ident!("__{}__{}_handler", self.config.attr_name, target.canonical_name());

        // Clone the function without the instruction attribute.
        let mut wrapped_fn = fn_item.clone();
        wrapped_fn.attrs.retain(|attr| !is_override_attr(attr, self.config));

        // Emit the wrapper module so the handler lives in its own scope.
        self.wrapper_defs.extend(quote! {
            mod #wrapper_mod {
                use super::*;
                #wrapped_fn
            }
        });

        Ok(HandlerMeta { wrapper_mod, context_type, fn_generics })
    }

    /// Rejects unattributed functions whose name collides with a known instruction.
    ///
    /// A bare `fn lz_receive(...)` without `#[oapp_instruction]`
    /// would silently shadow the generated entrypoint — catch that early.
    fn reject_name_collisions(&self, items: &[Item]) -> syn::Result<()> {
        for &ix in Ix::all() {
            let name = ix.canonical_name();
            let collision = items.iter().find_map(|item| match item {
                Item::Fn(f) if f.sig.ident == name && !has_override_attr(f, self.config) => {
                    Some(&f.sig.ident)
                },
                _ => None,
            });

            if let Some(ident) = collision {
                return Err(syn::Error::new_spanned(
                    ident,
                    format!(
                        "`fn {name}(...)` conflicts with {domain} instruction `{name}`: \
                        use #[{attr}] to override it",
                        domain = self.config.domain,
                        attr = self.config.attr_name,
                    ),
                ));
            }
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/// Returns `true` if the function carries the override attribute.
fn has_override_attr(fn_item: &ItemFn, cfg: OverrideConfig) -> bool {
    fn_item.attrs.iter().any(|attr| is_override_attr(attr, cfg))
}

/// Returns `true` if `attr`'s last path segment matches the configured attribute name.
fn is_override_attr(attr: &Attribute, cfg: OverrideConfig) -> bool {
    attr.path().segments.last().is_some_and(|s| s.ident == cfg.attr_name)
}

/// Parses the override target from a function's override attribute.
///
/// The instruction name is inferred from the handler's function name
/// (e.g. `fn set_paused(...)` → instruction `set_paused`).
/// The attribute must not contain any arguments.
///
/// Returns `Ok(None)` if the function has no such attribute,
/// `Ok(Some(ix))` on success, or `Err` on malformed attributes.
fn parse_override_target<Ix: InstructionSet>(
    fn_item: &ItemFn,
    cfg: OverrideConfig,
) -> syn::Result<Option<Ix>> {
    // Ensure at most one override attribute per function.
    let attr = fn_item
        .attrs
        .iter()
        .filter(|attr| is_override_attr(attr, cfg))
        .at_most_one()
        .map_err(|_| {
            syn::Error::new_spanned(fn_item, format!("duplicate #[{}] on function", cfg.attr_name))
        })?;

    // Early return if no override attribute is found.
    let Some(attr) = attr else {
        return Ok(None);
    };

    // Reject arguments — the instruction name is inferred from the function name.
    if !matches!(attr.meta, syn::Meta::Path(_)) {
        return Err(syn::Error::new_spanned(
            attr,
            format!("#[{}] does not accept arguments", cfg.attr_name),
        ));
    }

    // Infer the instruction from the handler's function name.
    let fn_ident = &fn_item.sig.ident;
    let ix = Ix::from_ident(fn_ident).ok_or_else(|| {
        syn::Error::new_spanned(
            fn_ident,
            format!("unsupported {} target `{fn_ident}`", cfg.attr_name),
        )
    })?;

    Ok(Some(ix))
}

/// Extracts the `Context<...>` type from the first `&Context<T>` or `&mut Context<T>` parameter.
///
/// Override handlers must accept `ctx` by reference — by-value `Context<T>` is rejected.
/// Returns the `Context<...>` type without the reference wrapper (preserving lifetimes).
fn infer_context_type(fn_item: &ItemFn) -> syn::Result<Type> {
    let Some(syn::FnArg::Typed(first)) = fn_item.sig.inputs.first() else {
        return Err(syn::Error::new_spanned(
            &fn_item.sig,
            "handler must have at least one parameter of type `&Context<T>` or `&mut Context<T>`",
        ));
    };

    // Require `&Context<T>` or `&mut Context<T>` — reject by-value `Context<T>`.
    let Type::Reference(ref_ty) = first.ty.as_ref() else {
        return Err(syn::Error::new_spanned(
            &first.ty,
            "expected `&Context<T>` or `&mut Context<T>` as the first parameter",
        ));
    };
    let inner_ty = ref_ty.elem.as_ref();

    // Validate that the referenced type is `Context<...>`.
    if !is_context_type(inner_ty) {
        return Err(syn::Error::new_spanned(
            &first.ty,
            "expected `&Context<T>` or `&mut Context<T>` as the first parameter",
        ));
    }

    Ok(inner_ty.clone())
}

/// Returns `true` if the type's last path segment is `Context`.
fn is_context_type(ty: &Type) -> bool {
    matches!(ty, Type::Path(tp) if tp.path.segments.last().is_some_and(|s| s.ident == "Context"))
}
