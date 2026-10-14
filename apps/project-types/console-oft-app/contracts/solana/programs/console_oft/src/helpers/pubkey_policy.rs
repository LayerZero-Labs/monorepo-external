use crate::{OFTError, OFTStore};
use anchor_lang::prelude::*;
use pubkey_policy_interface::ValidatedPubkeyPolicy;
use token_manager_interface::acl::AclError;

/// Reads `subject`'s answer from the pubkey policy selected on `oft_store`.
///
/// Both accounts are required when a policy is selected and rejected when none is, so omitting
/// them cannot disable screening. `policy` must be the selected account, whose owning program is
/// then trusted for its records, and be for the OFT's mint. `record` must be the subject's
/// canonical record address even when no record exists yet.
pub fn resolve_pubkey_policy<'info>(
    oft_store: &OFTStore,
    policy: Option<&UncheckedAccount<'info>>,
    record: Option<&UncheckedAccount<'info>>,
    subject: &Pubkey,
) -> Result<Option<ValidatedPubkeyPolicy>> {
    match (oft_store.pubkey_policy, policy, record) {
        (None, None, None) => Ok(None),
        (Some(expected), Some(policy), Some(record)) => {
            require_keys_eq!(policy.key(), expected, OFTError::InvalidPubkeyPolicy);
            // Its policy errors decode through this program's IDL: `OFTError` declares them.
            let validated = ValidatedPubkeyPolicy::read(policy, record, subject)?;
            require_keys_eq!(
                validated.mint(),
                oft_store.token_mint,
                OFTError::InvalidPubkeyPolicyMint
            );
            Ok(Some(validated))
        },
        _ => err!(OFTError::InvalidPubkeyPolicy),
    }
}

/// Maps shared ACL-interface failures into this program's error codes.
pub fn map_acl_error(error: AclError) -> anchor_lang::error::Error {
    match error {
        AclError::InvalidConfig => error!(OFTError::InvalidAclMintConfig),
        AclError::InvalidManifest => error!(OFTError::InvalidAclThawMetas),
        AclError::InvalidTokenAccount => error!(OFTError::InvalidAclTokenAccount),
        AclError::UnsupportedAccount => error!(OFTError::UnsupportedAclTokenAccount),
        AclError::Program(error) => error.into(),
    }
}
