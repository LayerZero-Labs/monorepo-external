//! Ultra light node errors

use core::byte_array::ByteArray;
use lz_utils::error::{Error, format_error};
use starknet::ContractAddress;

#[derive(Drop)]
pub enum UlnError {
    MustHaveAtLeastOneDvn,
    TooManyDvns,
    InvalidWorkerOptions,
    InvalidWorkerId,
    UnsupportedOptionType,
    InvalidOptionalDvnThreshold,
    UnsortedDvns,
    UnsupportedSendEid,
    UnsupportedReceiveEid,
    InvalidConfirmations,
    MessageTooLarge,
    CallerNotEndpoint,
    InvalidTreasuryNativeFeeCap,
    Verifying,
    InvalidConfigType,
    InvalidExecutor,
    ZeroMessageSize,
}

impl ErrorNameImpl of Error<UlnError> {
    fn prefix() -> ByteArray {
        "LZ_ULN"
    }

    fn name(self: UlnError) -> ByteArray {
        match self {
            UlnError::InvalidWorkerOptions => "INVALID_WORKER_OPTIONS",
            UlnError::InvalidWorkerId => "INVALID_WORKER_ID",
            UlnError::UnsupportedOptionType => "UNSUPPORTED_OPTION_TYPE",
            UlnError::MustHaveAtLeastOneDvn => "MUST_HAVE_AT_LEAST_ONE_DVN",
            UlnError::TooManyDvns => "TOO_MANY_DVNS",
            UlnError::InvalidOptionalDvnThreshold => "INVALID_OPTIONAL_DVN_THRESHOLD",
            UlnError::UnsortedDvns => "UNSORTED_DVNS",
            UlnError::UnsupportedSendEid => "UNSUPPORTED_SEND_EID",
            UlnError::UnsupportedReceiveEid => "UNSUPPORTED_RECEIVE_EID",
            UlnError::InvalidConfirmations => "INVALID_CONFIRMATIONS",
            UlnError::MessageTooLarge => "MESSAGE_TOO_LARGE",
            UlnError::CallerNotEndpoint => "CALLER_NOT_ENDPOINT",
            UlnError::InvalidTreasuryNativeFeeCap => "INVALID_TREASURY_NATIVE_FEE_CAP",
            UlnError::Verifying => "VERIFYING",
            UlnError::InvalidConfigType => "INVALID_CONFIG_TYPE",
            UlnError::InvalidExecutor => "INVALID_EXECUTOR",
            UlnError::ZeroMessageSize => "ZERO_MESSAGE_SIZE",
        }
    }
}

pub fn err_invalid_worker_options(cursor: usize) -> ByteArray {
    format_error(UlnError::InvalidWorkerOptions, format!("cursor: {}", cursor))
}

pub fn err_invalid_worker_id(worker_id: u8) -> ByteArray {
    format_error(UlnError::InvalidWorkerId, format!("worker_id: {}", worker_id))
}

pub fn err_unsupported_option_type(option_type: u16) -> ByteArray {
    format_error(UlnError::UnsupportedOptionType, format!("option_type: {}", option_type))
}

pub fn err_must_have_at_least_one_dvn() -> ByteArray {
    format_error(UlnError::MustHaveAtLeastOneDvn, "")
}

pub fn err_too_many_dvns(required_count: usize, optional_count: usize) -> ByteArray {
    format_error(
        UlnError::TooManyDvns,
        format!("required.count: {}, optional.count: {}", required_count, optional_count),
    )
}

pub fn err_invalid_optional_dvn_threshold(optional_dvn_length: usize, threshold: u8) -> ByteArray {
    format_error(
        UlnError::InvalidOptionalDvnThreshold,
        format!("array length: {}, threshold: {}", optional_dvn_length, threshold),
    )
}

pub fn err_unsorted_dvns() -> ByteArray {
    format_error(
        UlnError::UnsortedDvns, "DVNs must be sorted in ascending order with no duplicates",
    )
}

pub fn err_unsupported_send_eid(eid: u32) -> ByteArray {
    format_error(UlnError::UnsupportedSendEid, format!("eid: {}", eid))
}

pub fn err_unsupported_receive_eid(eid: u32) -> ByteArray {
    format_error(UlnError::UnsupportedReceiveEid, format!("eid: {}", eid))
}

pub fn err_invalid_confirmations() -> ByteArray {
    format_error(UlnError::InvalidConfirmations, "confirmations must be greater than 0")
}

pub fn err_message_too_large(message_size: usize, max_message_size: usize) -> ByteArray {
    format_error(
        UlnError::MessageTooLarge,
        format!("message_size: {}, max_message_size: {}", message_size, max_message_size),
    )
}

pub fn err_caller_not_endpoint(caller: ContractAddress, endpoint: ContractAddress) -> ByteArray {
    let caller_str: felt252 = caller.try_into().unwrap();
    let endpoint_str: felt252 = endpoint.try_into().unwrap();
    format_error(
        UlnError::CallerNotEndpoint, format!("caller: {}, endpoint: {}", caller_str, endpoint_str),
    )
}

pub fn err_invalid_treasury_native_fee_cap(old_cap: u256, new_cap: u256) -> ByteArray {
    format_error(
        UlnError::InvalidTreasuryNativeFeeCap,
        format!("old_cap: {}, new_cap: {}", old_cap, new_cap),
    )
}

pub fn err_uln_verifying() -> ByteArray {
    format_error(UlnError::Verifying, "Verification not ready for commit")
}

pub fn err_invalid_config_type(config_type: u32) -> ByteArray {
    format_error(UlnError::InvalidConfigType, format!("config_type: {}", config_type))
}

pub fn err_invalid_executor() -> ByteArray {
    format_error(UlnError::InvalidExecutor, "")
}

pub fn err_zero_message_size() -> ByteArray {
    format_error(UlnError::ZeroMessageSize, "")
}
