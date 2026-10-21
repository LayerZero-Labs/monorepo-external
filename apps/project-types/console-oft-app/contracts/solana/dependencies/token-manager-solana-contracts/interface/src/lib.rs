//! TokenManager ABI: root state, signer PDAs, the `permissioned_burn` instruction and the ACL gate
//! integration. Pubkey-policy records and readers live in `pubkey-policy-interface`.

pub mod acl;
pub mod burn;
mod seeds;
mod state;
mod version;

pub use seeds::*;
pub use state::*;
pub use version::*;

use anchor_lang::prelude::*;

program_id::declare_program_id!("TOKEN_MANAGER_ID", "79cu2QNvp92chEmBhBgcUfERDT9KHnUcr8eiJb5WzKML");
