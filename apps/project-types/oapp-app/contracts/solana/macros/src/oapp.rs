//! Top-level `#[oapp]` attribute macro implementation.
//!
//! Flow: parse inputs and resolve domain types, then collect → generate → assemble.

use crate::{
    instructions::oapp::{accept_default_admin_transfer, CodegenContext, OAppInstructionSet},
    state_types,
};
use anchor_trait::{generate_instructions, Assembly, InstructionOverrides, OverrideConfig};
use darling::{ast::NestedMeta, FromMeta};
use proc_macro2::TokenStream;
use quote::{format_ident, quote};
use syn::ItemMod;

// ---------------------------------------------------------------------------
// Attribute parsing
// ---------------------------------------------------------------------------

#[derive(FromMeta)]
struct OAppAttr {
    state: syn::Path,
    role_type: syn::Path,
}

const OVERRIDE_CONFIG: OverrideConfig =
    OverrideConfig { attr_name: "oapp_instruction", domain: "OApp" };

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

pub fn expand(attr: TokenStream, item: TokenStream) -> syn::Result<TokenStream> {
    // Parse inputs
    let attr_args = NestedMeta::parse_meta_list(attr)?;
    let attrs = OAppAttr::from_list(&attr_args)?;
    let module = syn::parse2::<ItemMod>(item)?;

    // Resolve domain-specific types and token streams
    let state = &attrs.state;
    let role = &attrs.role_type;

    // 1. Collect overrides
    let overrides = InstructionOverrides::collect(&module, OVERRIDE_CONFIG)?;

    // 2. Generate instructions
    let codegen_ctx = CodegenContext { oapp_type: quote!(#state), role_type: quote!(#role) };
    let mut instructions = generate_instructions::<OAppInstructionSet>(&codegen_ctx, &overrides)?;

    // Always inject RBAC accept_default_admin_transfer handler override so the endpoint
    // delegate is automatically synced with the new admin (EVM parity:
    // OAppCoreRBACUpgradeable). Reuses RBAC's StdAcceptDefaultAdminTransfer accounts.
    // This is unconditional — programs cannot override this instruction.
    instructions.entrypoints.extend(accept_default_admin_transfer::generate());

    // 3. Assemble output
    let peer_prelude = state_types::generate_peer();
    let enforced_options_prelude = state_types::generate_enforced_options();
    let prelude = {
        quote! {
            #peer_prelude
            #enforced_options_prelude

            use ::oapp::OAppState as _;
            use ::oapp::MessagingChannelRoles as _;
        }
    };
    let extra_mod_attrs = quote! {
        #[::rbac::rbac(state = #state, role_type = #role)]
    };

    Ok(Assembly {
        prelude,
        overrides,
        instructions,
        extra_mod_attrs,
        source_mod: module,
        extend_macro_name: Some(format_ident!("oapp_extend_accounts")),
    }
    .assemble())
}
