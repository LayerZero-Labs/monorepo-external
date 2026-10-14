//! State struct generators for the `#[rbac]` macro.
//!
//! Contains token-stream generators for RBAC state account types:
//! - `RoleMember` — proves an account holds a specific role (PDA existence = hasRole).
//! - `DefaultAdmin` derive — validates and implements the DefaultAdmin trait on the root account.

use proc_macro2::TokenStream;
use quote::quote;
use syn::DeriveInput;

use crate::utils;

/// Generates the `RoleMember` account struct parameterised by the caller's role type.
///
/// The `state`, `role` and `account` fields repeat the PDA seeds. Storing them in the account
/// data lets `getProgramAccounts` enumerate members with `memcmp` filters: one program can hold
/// many states (one per `OFTStore`, TokenManager root or policy), and without `state` in the
/// data a role filter returns members of every state in the program, including states anyone
/// can create.
///
/// **IMPORTANT**: Field ordering matters for RPC filtering!
/// - `state` MUST be the first field (offset 8, after the 8-byte Anchor discriminator) and `role`
///   the second (offset 40), so discriminator + state, or discriminator + state + role, is a single
///   contiguous `memcmp` prefix.
///
/// Example RPC query to enumerate the members of one role in one state:
/// ```json
/// {
///   "method": "getProgramAccounts",
///   "params": [
///     "<PROGRAM_ID>",
///     {
///       "filters": [
///         { "dataSize": 74 },  // 8 (discriminator) + 32 (state) + 1 (role) + 32 (account) + 1 (bump)
///         { "memcmp": { "offset": 0, "bytes": "<DISCRIMINATOR_STATE_AND_ROLE_BASE58>" } }
///       ]
///     }
///   ]
/// }
/// ```
///
/// The memcmp bytes are discriminator (8) + state (32) + role (1) = 41 bytes; drop the role byte
/// to list every member of the state.
///
/// This achieves similar functionality to EVM's AccessControlEnumerable:
/// - EVM: getRoleMember(role, index) - O(1) lookup by index
/// - Solana: getProgramAccounts with filters - returns all members at once
pub fn generate_role_member(role_type: &TokenStream) -> TokenStream {
    quote! {
        #[account]
        #[derive(Default, InitSpace)]
        pub struct RoleMember {
            /// The state account the role is scoped to. MUST be the first field (offset 8) for
            /// RPC enumeration filtering.
            pub state: Pubkey,
            /// The role type. MUST be the second field (offset 40) for RPC enumeration filtering.
            pub role: #role_type,
            /// The account's public key who holds this role.
            pub account: Pubkey,
            /// PDA bump seed.
            pub bump: u8,
        }
    }
}

/// Derive macro implementation for `DefaultAdmin` trait.
///
/// Validates that the struct has `current_default_admin` and `pending_default_admin`
/// fields, then generates `impl ::rbac::traits::DefaultAdmin for T`.
pub fn generate_default_admin_derive(input: TokenStream) -> syn::Result<TokenStream> {
    let input = syn::parse2::<DeriveInput>(input)?;
    let name = &input.ident;
    utils::validate_named_struct(
        &input,
        "DefaultAdmin",
        &["current_default_admin", "pending_default_admin"],
    )?;

    Ok(quote! {
        impl ::rbac::traits::DefaultAdmin for #name {
            fn set_pending_default_admin(&mut self, admin: Pubkey) {
                self.pending_default_admin = admin;
            }

            fn pending_default_admin(&self) -> &Pubkey {
                &self.pending_default_admin
            }

            fn set_current_default_admin(&mut self, admin: Pubkey) {
                self.current_default_admin = admin;
            }

            fn current_default_admin(&self) -> &Pubkey {
                &self.current_default_admin
            }
        }
    })
}
