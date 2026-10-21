//! Top-level `#[rbac]` attribute macro implementation.
//!
//! Flow: parse inputs and resolve domain types, then collect → generate → assemble.

use crate::{
    instructions::{CodegenContext, RbacInstructionSet},
    state_types,
};
use anchor_trait::{generate_instructions, Assembly, InstructionOverrides, OverrideConfig};
use darling::{ast::NestedMeta, FromMeta};
use proc_macro2::TokenStream;
use quote::{format_ident, quote};
use syn::{ItemMod, Path};

// ---------------------------------------------------------------------------
// Attribute parsing
// ---------------------------------------------------------------------------

#[derive(FromMeta)]
struct RbacAttr {
    state: Path,
    role_type: Path,
}

const OVERRIDE_CONFIG: OverrideConfig =
    OverrideConfig { attr_name: "rbac_instruction", domain: "RBAC" };

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

pub fn expand(attr: TokenStream, item: TokenStream) -> syn::Result<TokenStream> {
    // Parse inputs
    let attr_args = NestedMeta::parse_meta_list(attr)?;
    let attrs = RbacAttr::from_list(&attr_args)?;
    let module = syn::parse2::<ItemMod>(item)?;

    // Resolve domain-specific types and token streams
    let state = &attrs.state;
    let role = &attrs.role_type;

    // 1. Collect overrides
    let overrides = InstructionOverrides::collect(&module, OVERRIDE_CONFIG)?;

    // 2. Generate instructions
    let codegen_ctx = CodegenContext { role_type: quote!(#role), state_type: quote!(#state) };
    let instructions = generate_instructions::<RbacInstructionSet>(&codegen_ctx, &overrides)?;

    // 3. Assemble output
    let role_ts = quote!(#role);
    let role_member_prelude = state_types::generate_role_member(&role_ts);
    let prelude = quote! {
        use ::rbac::traits::RoleType as _;
        use ::rbac::traits::DefaultAdmin as _;

        #role_member_prelude
    };

    Ok(Assembly {
        prelude,
        overrides,
        instructions,
        extra_mod_attrs: TokenStream::new(),
        source_mod: module,
        extend_macro_name: Some(format_ident!("rbac_extend_accounts")),
    }
    .assemble())
}
