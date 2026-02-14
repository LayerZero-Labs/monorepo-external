use lz_utils::bytes::Bytes32;
use lz_utils::error::{Error, format_error};
use starknet::ContractAddress;

#[derive(Drop)]
pub enum OAppCoreError {
    OnlyEndpoint,
    OnlyPeer,
    NoPeer,
    NotEnoughNative,
    NotEnoughNativeAllowance,
    NotEnoughLzToken,
    NotEnoughLzTokenAllowance,
    LzTokenUnavailable,
    TransferFailed,
    ApprovalFailed,
    InvalidDelegate,
}

impl ErrorNameImpl of Error<OAppCoreError> {
    fn prefix() -> ByteArray {
        "LZ_OAPP_CORE"
    }

    fn name(self: OAppCoreError) -> ByteArray {
        match self {
            OAppCoreError::OnlyEndpoint => "ONLY_ENDPOINT",
            OAppCoreError::OnlyPeer => "ONLY_PEER",
            OAppCoreError::NoPeer => "NO_PEER",
            OAppCoreError::NotEnoughNative => "NOT_ENOUGH_NATIVE",
            OAppCoreError::NotEnoughNativeAllowance => "NOT_ENOUGH_NATIVE_ALLOWANCE",
            OAppCoreError::NotEnoughLzToken => "NOT_ENOUGH_LZ_TOKEN",
            OAppCoreError::NotEnoughLzTokenAllowance => "NOT_ENOUGH_LZ_TOKEN_ALLOWANCE",
            OAppCoreError::LzTokenUnavailable => "LZ_TOKEN_UNAVAILABLE",
            OAppCoreError::TransferFailed => "TRANSFER_FAILED",
            OAppCoreError::ApprovalFailed => "APPROVAL_FAILED",
            OAppCoreError::InvalidDelegate => "INVALID_DELEGATE",
        }
    }
}

pub fn err_only_endpoint(endpoint: ContractAddress) -> ByteArray {
    format_error(OAppCoreError::OnlyEndpoint, format!("{:?}", endpoint))
}

pub fn err_only_peer(eid: u32, peer: Bytes32) -> ByteArray {
    format_error(OAppCoreError::OnlyPeer, format!("eid: {:?}, peer: {:?}", eid, peer))
}

pub fn err_no_peer(eid: u32) -> ByteArray {
    format_error(OAppCoreError::NoPeer, format!("eid: {:?}", eid))
}

pub fn err_not_enough_native(fee: u256, balance: u256) -> ByteArray {
    format_error(OAppCoreError::NotEnoughNative, format!("fee: {:?}, balance: {:?}", fee, balance))
}

pub fn err_not_enough_lz_token(fee: u256, balance: u256) -> ByteArray {
    format_error(OAppCoreError::NotEnoughLzToken, format!("fee: {:?}, balance: {:?}", fee, balance))
}

pub fn err_lz_token_unavailable() -> ByteArray {
    format_error(OAppCoreError::LzTokenUnavailable, "")
}

pub fn err_not_enough_lz_token_allowance(fee: u256, allowance: u256) -> ByteArray {
    format_error(
        OAppCoreError::NotEnoughLzTokenAllowance,
        format!("fee: {:?}, allowance: {:?}", fee, allowance),
    )
}

pub fn err_not_enough_native_allowance(fee: u256, allowance: u256) -> ByteArray {
    format_error(
        OAppCoreError::NotEnoughNativeAllowance,
        format!("fee: {:?}, allowance: {:?}", fee, allowance),
    )
}

pub fn err_transfer_failed() -> ByteArray {
    format_error(OAppCoreError::TransferFailed, "")
}

pub fn err_approval_failed() -> ByteArray {
    format_error(OAppCoreError::ApprovalFailed, "")
}

pub fn err_invalid_delegate() -> ByteArray {
    format_error(OAppCoreError::InvalidDelegate, "")
}
