//! Top-level `#[oft]` attribute macro implementation.
//!
//! Flow: parse attribute inputs, then collect overrides → generate instructions → assemble.

use crate::instructions::{CodegenContext, OftInstructionSet};
use anchor_trait::{generate_instructions, Assembly, InstructionOverrides, OverrideConfig};
use darling::{ast::NestedMeta, FromMeta};
use proc_macro2::TokenStream;
use quote::quote;
use syn::{ItemMod, Path};

// ---------------------------------------------------------------------------
// Attribute parsing
// ---------------------------------------------------------------------------

#[derive(FromMeta)]
struct OFTAttr {
    /// The program state account TYPE (e.g., OFTStore).
    state: Path,
    /// The RBAC role enum TYPE.
    role_type: Path,
}

const OVERRIDE_CONFIG: OverrideConfig =
    OverrideConfig { attr_name: "oft_instruction", domain: "OFT" };

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

pub fn expand(attr: TokenStream, item: TokenStream) -> syn::Result<TokenStream> {
    // Parse attribute inputs and the annotated module.
    let attr_args = NestedMeta::parse_meta_list(attr)?;
    let attrs = OFTAttr::from_list(&attr_args)?;
    let module = syn::parse2::<ItemMod>(item)?;

    let oft_type = &attrs.state;
    let role_type = &attrs.role_type;

    // 1. Collect overrides
    let overrides = InstructionOverrides::collect(&module, OVERRIDE_CONFIG)?;

    // 2. Generate instructions
    let codegen_ctx = CodegenContext {};
    let instructions = generate_instructions::<OftInstructionSet>(&codegen_ctx, &overrides)?;

    // 3. Assemble output
    let extra_mod_attrs = quote! {
        #[::oapp::oapp(state = #oft_type, role_type = #role_type)]
    };

    Ok(Assembly {
        prelude: TokenStream::new(),
        overrides,
        instructions,
        extra_mod_attrs,
        source_mod: module,
        extend_macro_name: None,
    }
    .assemble())
}
