//! OFT Mint Burn Adapter errors

use lz_utils::error::{Error, format_error};
use starknet::ContractAddress;

#[derive(Drop)]
pub enum OFTMintBurnAdapterError {
    NoFeesToWithdraw,
    TransferFailed,
    CallerNotOwnerOrMissingRole,
}

impl OFTMintBurnAdapterErrorImpl of Error<OFTMintBurnAdapterError> {
    fn prefix() -> ByteArray {
        "OFT_MINT_BURN_ADAPTER"
    }

    fn name(self: OFTMintBurnAdapterError) -> ByteArray {
        match self {
            OFTMintBurnAdapterError::NoFeesToWithdraw => "NO_FEES_TO_WITHDRAW",
            OFTMintBurnAdapterError::TransferFailed => "TRANSFER_FAILED",
            OFTMintBurnAdapterError::CallerNotOwnerOrMissingRole => "CALLER_NOT_OWNER_OR_MISSING_ROLE",
        }
    }
}

pub fn err_no_fees_to_withdraw() -> ByteArray {
    format_error(OFTMintBurnAdapterError::NoFeesToWithdraw, "")
}

pub fn err_transfer_failed(to: ContractAddress, amount: u256) -> ByteArray {
    format_error(
        OFTMintBurnAdapterError::TransferFailed, format!("to: {:?}, amount: {:?}", to, amount),
    )
}

pub fn err_caller_not_owner_or_missing_role(role: felt252) -> ByteArray {
    format_error(OFTMintBurnAdapterError::CallerNotOwnerOrMissingRole, format!("role: {:?}", role))
}
