//! ABI of the permissionless pubkey-policy oracle: policies, subject records and consumer reads.
//! Consumers bind the policy they accept; a policy result says nothing about native freeze or
//! pause.

mod error;
mod pubkey_policy;
mod seeds;
mod state;
mod version;

pub use error::*;
pub use pubkey_policy::*;
pub use seeds::*;
pub use state::*;
pub use version::*;

use anchor_lang::prelude::*;

program_id::declare_program_id!("PUBKEY_POLICY_ID", "AbtWNPXHcppLsNV6Y2uZYmqD5uAN8BBPKGngqvniFu3U");
