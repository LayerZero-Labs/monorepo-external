//! DVN errors

use lz_utils::bytes::Bytes32;
use lz_utils::error::{Error, format_error};
use starknet::ContractAddress;

#[derive(Drop, Clone, Debug, PartialEq)]
pub enum DvnError {
    InvalidDvnIdx,
    InvalidDVNOptions,
    EidNotSupported,
    PriceFeedNotSet,
    WorkerFeeLibNotSet,
    InstructionExpired,
    InvalidVid,
    InvalidTarget,
    InvalidSelector,
    InvalidQuorumAdmin,
    InvalidRole,
    DuplicatedHash,
    TransferFailed,
}

impl DvnErrorImpl of Error<DvnError> {
    fn prefix() -> ByteArray {
        "LZ_DVN"
    }

    fn name(self: DvnError) -> ByteArray {
        match self {
            DvnError::InvalidDvnIdx => "INVALID_DVN_IDX",
            DvnError::InvalidDVNOptions => "INVALID_DVN_OPTIONS",
            DvnError::EidNotSupported => "EID_NOT_SUPPORTED",
            DvnError::PriceFeedNotSet => "PRICE_FEED_NOT_SET",
            DvnError::WorkerFeeLibNotSet => "WORKER_FEELIB_NOT_SET",
            DvnError::InstructionExpired => "INSTRUCTION_EXPIRED",
            DvnError::InvalidVid => "INVALID_VID",
            DvnError::InvalidTarget => "INVALID_TARGET",
            DvnError::InvalidSelector => "INVALID_SELECTOR",
            DvnError::InvalidQuorumAdmin => "INVALID_QUORUM_ADMIN",
            DvnError::DuplicatedHash => "DUPLICATED_HASH",
            DvnError::InvalidRole => "INVALID_ROLE",
            DvnError::TransferFailed => "TRANSFER_FAILED",
        }
    }
}

pub fn err_invalid_dvn_idx() -> ByteArray {
    format_error(DvnError::InvalidDvnIdx, "")
}

pub fn err_invalid_dvn_options(cursor: usize) -> ByteArray {
    format_error(DvnError::InvalidDVNOptions, format!("cursor: {}", cursor))
}

pub fn err_eid_not_supported(eid: u32) -> ByteArray {
    format_error(DvnError::EidNotSupported, format!("eid: {}", eid))
}

pub fn err_price_feed_not_set() -> ByteArray {
    format_error(DvnError::PriceFeedNotSet, "")
}

pub fn err_worker_fee_lib_not_set() -> ByteArray {
    format_error(DvnError::WorkerFeeLibNotSet, "")
}

pub fn err_instruction_expired() -> ByteArray {
    format_error(DvnError::InstructionExpired, "")
}

pub fn err_invalid_vid(vid: u32) -> ByteArray {
    format_error(DvnError::InvalidVid, format!("vid: {}", vid))
}

pub fn err_invalid_target(target: ContractAddress) -> ByteArray {
    format_error(DvnError::InvalidTarget, format!("target: {:?}", target))
}

pub fn err_invalid_selector(selector: felt252) -> ByteArray {
    format_error(DvnError::InvalidSelector, format!("selector: {}", selector))
}

pub fn err_invalid_quorum_admin() -> ByteArray {
    format_error(DvnError::InvalidQuorumAdmin, "")
}

pub fn err_duplicated_hash(hash: Bytes32) -> ByteArray {
    format_error(DvnError::DuplicatedHash, format!("hash: {:?}", hash))
}

pub fn err_invalid_role(role: felt252) -> ByteArray {
    format_error(DvnError::InvalidRole, format!("role: {:?}", role))
}

pub fn err_transfer_failed() -> ByteArray {
    format_error(DvnError::TransferFailed, "")
}
