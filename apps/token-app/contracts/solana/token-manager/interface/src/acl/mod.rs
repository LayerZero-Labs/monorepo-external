//! Token ACL helpers that run in a consuming program: the mint's canonical config, the gate's thaw
//! manifest, and permissionless thaw through whatever gate that config names. Consumers learn the
//! gate's extra accounts only from its manifest, never from a gate's layout, so a new gate needs no
//! consumer upgrade. The thaw CPI goes to Token ACL directly, which checks the gate against its
//! config and resolves those accounts again from the same manifest.
//!
//! A consumer predicts the gate's answer with its own pubkey policy, since a gate that refuses
//! fails the whole transaction: the gate must admit whoever that policy allows, which is the
//! admins' job. A thawed account can still be blocked by other Token-2022 extensions such as Pause
//! or a hook.
mod manifest;
mod thaw;

pub use manifest::*;
pub use thaw::*;
pub use token_acl_interface::TOKEN_ACL_ID;

use anchor_lang::prelude::*;

/// Plain library errors; consumers map them into their own error codes.
#[derive(Debug)]
pub enum AclError {
    InvalidConfig,
    InvalidManifest,
    InvalidTokenAccount,
    UnsupportedAccount,
    Program(ProgramError),
}

impl From<ProgramError> for AclError {
    fn from(error: ProgramError) -> Self {
        Self::Program(error)
    }
}

pub type AclResult<T> = core::result::Result<T, AclError>;
