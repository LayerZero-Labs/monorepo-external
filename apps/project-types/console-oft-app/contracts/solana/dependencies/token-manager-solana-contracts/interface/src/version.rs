//! The versions this program's build speaks, returned by its `get_version` view.
use anchor_lang::prelude::*;

/// Same layout as the OApp standard's `IdlVersion`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, AnchorSerialize, AnchorDeserialize)]
pub struct IdlVersion {
    pub major: u8,
    pub minor: u8,
}

/// What a build speaks, for SDKs choosing parsers. `schema_version` bumps when an account layout
/// changes; `idl_version` when instructions or events change, its `major` for breaking changes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, AnchorSerialize, AnchorDeserialize)]
pub struct ProgramVersion {
    pub schema_version: u8,
    pub idl_version: IdlVersion,
}

/// This build's versions.
pub const TOKEN_MANAGER_VERSION: ProgramVersion =
    ProgramVersion { schema_version: 1, idl_version: IdlVersion { major: 1, minor: 0 } };
