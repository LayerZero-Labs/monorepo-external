use anchor_lang::{prelude::*, ToAccountInfo};
use anchor_spl::token_interface::Mint;
use spl_discriminator::SplDiscriminate;
use spl_token_2022_interface::{
    extension::{
        permissioned_burn::PermissionedBurnConfig, transfer_fee::TransferFeeConfig, transfer_hook,
        BaseStateWithExtensions, StateWithExtensions,
    },
    state::Mint as MintState,
};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

/// Get the transfer hook program ID from mint extension.
///
/// Returns `None` when the mint doesn't have a transfer hook extension, or when the
/// extension exists but its program ID is unset.
pub fn get_transfer_hook_program_id(token_mint: &InterfaceAccount<Mint>) -> Result<Option<Pubkey>> {
    let token_mint_info = token_mint.to_account_info();
    let token_mint_data = token_mint_info.try_borrow_data()?;
    let token_mint_ext = StateWithExtensions::<MintState>::unpack(&token_mint_data)?;
    Ok(transfer_hook::get_program_id(&token_mint_ext))
}

/// Whether burning needs PermissionedBurn approval: a Token-2022 mint whose PB authority is set.
/// Token-2022 rejects a plain burn then, and a permissioned one otherwise, so `send` and any
/// planner of it must select the path from this live state, never from supplied accounts.
pub fn permissioned_burn_active(token_mint: &InterfaceAccount<Mint>) -> Result<bool> {
    let info = token_mint.to_account_info();
    if info.owner != &spl_token_2022_interface::ID {
        return Ok(false);
    }
    let data = info.try_borrow_data()?;
    let mint = StateWithExtensions::<MintState>::unpack(&data)?;
    Ok(mint
        .get_extension::<PermissionedBurnConfig>()
        .is_ok_and(|config| Option::<Pubkey>::from(config.authority).is_some()))
}

/// Whether a Token-2022 transfer of this mint withholds a fee in the current epoch. Send and
/// receive move gross amounts and never reconcile balances, so they refuse while one is live. A
/// TransferFee extension at 0 bps or a zero maximum fee is allowed; a fee scheduled for a later
/// epoch is refused once that epoch starts.
pub fn transfer_fee_active(token_mint: &InterfaceAccount<Mint>) -> Result<bool> {
    let info = token_mint.to_account_info();
    if info.owner != &spl_token_2022_interface::ID {
        return Ok(false);
    }
    let data = info.try_borrow_data()?;
    let mint = StateWithExtensions::<MintState>::unpack(&data)?;
    let Ok(config) = mint.get_extension::<TransferFeeConfig>() else {
        return Ok(false);
    };
    let fee = config.get_epoch_fee(Clock::get()?.epoch);
    Ok(u16::from(fee.transfer_fee_basis_points) != 0 && u64::from(fee.maximum_fee) != 0)
}

/// The mint's live supply, read from its data rather than a deserialized copy that CPIs may have
/// left stale.
pub fn mint_supply(token_mint: &InterfaceAccount<Mint>) -> Result<u64> {
    let info = token_mint.to_account_info();
    let data = info.try_borrow_data()?;
    Ok(StateWithExtensions::<MintState>::unpack(&data)?.base.supply)
}

const TRANSFER_HOOK_EXECUTE_DISCRIMINATOR_LEN: usize =
    ExecuteInstruction::SPL_DISCRIMINATOR_SLICE.len();
const TRANSFER_HOOK_EXECUTE_DATA_LEN: usize =
    TRANSFER_HOOK_EXECUTE_DISCRIMINATOR_LEN + std::mem::size_of::<u64>();

/// Build the SPL Transfer Hook `Execute` instruction data that
/// `ExtraAccountMeta::resolve` expects: `[discriminator (8 bytes) | amount (8 bytes LE)]`.
///
/// This is the same payload Token-2022 hands to the hook's `Execute` entry point during
/// a real transfer; the resolver needs it because some extra-account seeds reference
/// fields inside the instruction data.
pub fn build_transfer_hook_execute_data(amount: u64) -> [u8; TRANSFER_HOOK_EXECUTE_DATA_LEN] {
    let mut data = [0; TRANSFER_HOOK_EXECUTE_DATA_LEN];
    data[..TRANSFER_HOOK_EXECUTE_DISCRIMINATOR_LEN]
        .copy_from_slice(ExecuteInstruction::SPL_DISCRIMINATOR_SLICE);
    data[TRANSFER_HOOK_EXECUTE_DISCRIMINATOR_LEN..].copy_from_slice(&amount.to_le_bytes());
    data
}

#[cfg(test)]
mod tests {
    use super::*;
    use spl_token_2022_interface::{
        extension::{
            permissioned_burn::PermissionedBurnConfig, transfer_hook::TransferHook,
            BaseStateWithExtensionsMut, ExtensionType, PodStateWithExtensionsMut,
        },
        pod::PodMint,
    };
    use spl_transfer_hook_interface::instruction::TransferHookInstruction;

    #[test]
    fn execute_data_matches_spl_encoding() {
        for amount in [0, 1, 0x0102_0304_0506_0708, u64::MAX] {
            let expected = TransferHookInstruction::Execute { amount }.pack();
            assert_eq!(build_transfer_hook_execute_data(amount).as_slice(), expected.as_slice());
        }
    }

    #[test]
    fn hook_resolution_accepts_permissioned_burn_before_hook_extension() {
        let mint_key = Pubkey::new_unique();
        let hook_program = Pubkey::new_unique();
        let authority = Pubkey::new_unique();
        let space = ExtensionType::try_calculate_account_len::<PodMint>(&[
            ExtensionType::PermissionedBurn,
            ExtensionType::TransferHook,
        ])
        .unwrap();
        let mut data = vec![0; space];
        {
            let mut state =
                PodStateWithExtensionsMut::<PodMint>::unpack_uninitialized(&mut data).unwrap();
            state.init_extension::<PermissionedBurnConfig>(true).unwrap().authority =
                Some(authority).try_into().unwrap();
            state.init_extension::<TransferHook>(true).unwrap().program_id =
                Some(hook_program).try_into().unwrap();
            state.base.is_initialized = true.into();
            state.base.decimals = 6;
            state.init_account_type().unwrap();
        }
        let mut lamports = 1;
        let token_program = spl_token_2022_interface::ID;
        let info = AccountInfo::new(
            &mint_key,
            false,
            false,
            &mut lamports,
            &mut data,
            &token_program,
            false,
        );
        let mint = InterfaceAccount::<Mint>::try_from(&info).unwrap();
        assert_eq!(get_transfer_hook_program_id(&mint).unwrap(), Some(hook_program));
    }
}
