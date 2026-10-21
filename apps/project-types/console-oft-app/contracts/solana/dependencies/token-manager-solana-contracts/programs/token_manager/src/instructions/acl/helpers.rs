//! Token ACL CPIs and MintConfig reads shared by the handlers.
use crate::{authority::invoke_as, errors::TokenManagerError, SignerKind};
use anchor_lang::prelude::*;
use spl_tlv_account_resolution::state::ExtraAccountMetaList;
use token_acl_client::accounts::MintConfig;
use token_acl_interface::instruction::{
    CanFreezePermissionlessInstruction, CanThawPermissionlessInstruction,
};
use token_manager_interface::acl::{self, gate_account_metas};

/// Writes both gate manifests for `pubkey_policy`, owned by `policy_program`. Zeroed first because
/// `init` refuses a TLV entry that already exists, and `init_acl` may rewrite a manifest to rebind
/// it.
pub(super) fn write_acl_manifests(
    thaw: &AccountInfo,
    freeze: &AccountInfo,
    pubkey_policy: &Pubkey,
    policy_program: &Pubkey,
) -> Result<()> {
    let metas = gate_account_metas(pubkey_policy, policy_program)?;
    thaw.try_borrow_mut_data()?.fill(0);
    freeze.try_borrow_mut_data()?.fill(0);
    ExtraAccountMetaList::init::<CanThawPermissionlessInstruction>(
        &mut thaw.try_borrow_mut_data()?,
        &metas,
    )?;
    ExtraAccountMetaList::init::<CanFreezePermissionlessInstruction>(
        &mut freeze.try_borrow_mut_data()?,
        &metas,
    )?;
    Ok(())
}

/// `mint`'s canonical Token ACL MintConfig (see [`acl::read_mint_config`]). That read fails only
/// with `InvalidConfig` or a program error, which passes through.
pub(crate) fn read_mint_config(
    mint_config_info: &AccountInfo,
    mint: &Pubkey,
) -> Result<MintConfig> {
    acl::read_mint_config(mint_config_info, mint).map_err(|error| match error {
        acl::AclError::Program(error) => error.into(),
        _ => error!(TokenManagerError::InvalidConfig),
    })
}

/// Token ACL freeze or thaw of `token_account`, signed by `state`'s Acl signer. Token ACL rejects
/// the call unless that signer is the MintConfig's logical admin.
#[allow(clippy::too_many_arguments)]
pub(crate) fn set_frozen<'info>(
    frozen: bool,
    state: &Pubkey,
    acl_signer: &AccountInfo<'info>,
    bump: u8,
    mint: &AccountInfo<'info>,
    token_account: &AccountInfo<'info>,
    mint_config: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    acl_program: &AccountInfo<'info>,
) -> Result<()> {
    let ix = if frozen {
        token_acl_client::instructions::FreezeBuilder::new()
            .authority(*acl_signer.key)
            .mint(*mint.key)
            .token_account(*token_account.key)
            .mint_config(*mint_config.key)
            .instruction()
    } else {
        token_acl_client::instructions::ThawBuilder::new()
            .authority(*acl_signer.key)
            .mint(*mint.key)
            .token_account(*token_account.key)
            .mint_config(*mint_config.key)
            .instruction()
    };
    invoke_as(
        state,
        &[(SignerKind::Acl, bump)],
        &ix,
        &[
            acl_signer.clone(),
            mint.clone(),
            token_account.clone(),
            mint_config.clone(),
            token_program.clone(),
            acl_program.clone(),
        ],
    )
}
