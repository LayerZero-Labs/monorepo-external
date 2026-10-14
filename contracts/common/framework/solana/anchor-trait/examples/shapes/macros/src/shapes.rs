//! Top-level `#[shapes]` attribute macro implementation.
//!
//! Flow: parse inputs and resolve domain types, then collect -> generate -> assemble.

use crate::{
    instructions::{CodegenContext, ShapesInstructionSet},
    state_types,
};
use anchor_trait::{generate_instructions, Assembly, InstructionOverrides, OverrideConfig};
use proc_macro2::TokenStream;
use quote::{format_ident, quote};
use syn::ItemMod;

const OVERRIDE_CONFIG: OverrideConfig =
    OverrideConfig { attr_name: "shapes_instruction", domain: "Shapes" };

pub fn expand(_attr: TokenStream, item: TokenStream) -> syn::Result<TokenStream> {
    let module = syn::parse2::<ItemMod>(item)?;

    // 1. Collect overrides
    let overrides = InstructionOverrides::collect(&module, OVERRIDE_CONFIG)?;

    // 2. Generate instructions
    let codegen_ctx = CodegenContext { state_type: quote!(ShapeState) };
    let instructions = generate_instructions::<ShapesInstructionSet>(&codegen_ctx, &overrides)?;

    // 3. Assemble output
    let prelude = {
        let shape_state = state_types::generate_shape_state();
        quote! {
            #shape_state
        }
    };
    let extra_mod_attrs = quote! {
        #[shapes_macros::shapes_audit]
    };

    Ok(Assembly {
        prelude,
        overrides,
        instructions,
        extra_mod_attrs,
        source_mod: module,
        extend_macro_name: Some(format_ident!("shapes_extend_accounts")),
    }
    .assemble())
}
