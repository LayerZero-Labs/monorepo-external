//! Top-level `#[composer]` attribute macro implementation.
//!
//! Flow: parse module, then collect → generate → assemble.
//! All three instructions are required — no attribute args needed.

use crate::instructions::composer::{ComposerCodegenContext, ComposerInstructionSet};
use anchor_trait::{generate_instructions, Assembly, InstructionOverrides, OverrideConfig};
use proc_macro2::TokenStream;
use syn::ItemMod;

const OVERRIDE_CONFIG: OverrideConfig =
    OverrideConfig { attr_name: "composer_instruction", domain: "Composer" };

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

pub fn expand(_attr: TokenStream, item: TokenStream) -> syn::Result<TokenStream> {
    let module = syn::parse2::<ItemMod>(item)?;

    // 1. Collect overrides
    let overrides = InstructionOverrides::collect(&module, OVERRIDE_CONFIG)?;

    // 2. Generate instructions
    let codegen_ctx = ComposerCodegenContext;
    let instructions = generate_instructions::<ComposerInstructionSet>(&codegen_ctx, &overrides)?;

    // 3. Assemble output
    let prelude = TokenStream::new();
    let extra_mod_attrs = TokenStream::new();

    Ok(Assembly {
        prelude,
        overrides,
        instructions,
        extra_mod_attrs,
        source_mod: module,
        extend_macro_name: None,
    }
    .assemble())
}
