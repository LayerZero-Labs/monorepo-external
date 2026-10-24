//! EndpointV2 errors

use lz_utils::error::{Error, format_error};
use starknet::ContractAddress;

#[derive(Drop)]
pub enum EndpointV2Error {
    /// Triggered when a message is committed by a contract that is not a valid receive library for
    /// the given path.
    InvalidReceiveLibrary,
    /// Triggered when an attempt is made to commit a message to a path that has not been
    /// initialized.
    PathNotInitializable,
    PathNotVerifiable,
    InvalidPayloadHash,
    /// Triggered when a message with an invalid nonce is received.
    InvalidNonce,
    /// Triggered when the payload hash of a received message does not match the committed payload
    /// hash.
    PayloadHashNotFound,
    /// Triggered when the value sent with `lz_receive` exceeds the executor's token allowance.
    LzReceiveValueExceedsAllowance,
    /// Triggered when an unauthorized address attempts to perform a restricted action.
    Unauthorized,
    /// Triggered when an attempt is made to pay fees in the LZ token, but no LZ token address is
    /// set.
    LzTokenUnavailable,
    /// Triggered when an attempt is made to pay fees in the LZ token, but the fee is zero.
    ZeroLzTokenFee,
    /// Triggered when the fees provided are insufficient to cover the cost of the message.
    InsufficientFee,
    /// Triggered when the transfer of a native token fails.
    NativeTransferFailed,
    /// Triggered when the transfer of the ZRO token fails.
    ZroTransferFailed,
    /// Triggered when the LZ token address is the same as the native token address.
    InvalidLzTokenAddress,
}

impl ErrorNameImpl of Error<EndpointV2Error> {
    fn prefix() -> ByteArray {
        "LZ_ENDPOINT"
    }

    fn name(self: EndpointV2Error) -> ByteArray {
        match self {
            EndpointV2Error::InvalidReceiveLibrary => "INVALID_RECEIVE_LIBRARY",
            EndpointV2Error::PathNotInitializable => "PATH_NOT_INITIALIZABLE",
            EndpointV2Error::PathNotVerifiable => "PATH_NOT_VERIFIABLE",
            EndpointV2Error::InvalidPayloadHash => "INVALID_PAYLOAD_HASH",
            EndpointV2Error::InvalidNonce => "INVALID_NONCE",
            EndpointV2Error::PayloadHashNotFound => "PAYLOAD_HASH_NOT_FOUND",
            EndpointV2Error::LzReceiveValueExceedsAllowance => "LZ_RECEIVE_VALUE_EXCEEDS_ALLOWANCE",
            EndpointV2Error::Unauthorized => "UNAUTHORIZED",
            EndpointV2Error::LzTokenUnavailable => "LZ_TOKEN_UNAVAILABLE",
            EndpointV2Error::ZeroLzTokenFee => "ZERO_LZ_TOKEN_FEE",
            EndpointV2Error::InsufficientFee => "INSUFFICIENT_FEE",
            EndpointV2Error::NativeTransferFailed => "NATIVE_TRANSFER_FAILED",
            EndpointV2Error::ZroTransferFailed => "ZRO_TRANSFER_FAILED",
            EndpointV2Error::InvalidLzTokenAddress => "INVALID_LZ_TOKEN_ADDRESS",
        }
    }
}

pub fn err_invalid_receive_library() -> ByteArray {
    format_error(EndpointV2Error::InvalidReceiveLibrary, "")
}

pub fn err_path_not_initializable() -> ByteArray {
    format_error(EndpointV2Error::PathNotInitializable, "")
}

pub fn err_path_not_verifiable() -> ByteArray {
    format_error(EndpointV2Error::PathNotVerifiable, "")
}

pub fn err_invalid_payload_hash() -> ByteArray {
    format_error(EndpointV2Error::InvalidPayloadHash, "")
}

pub fn err_lz_receive_value_exceeds_allowance(
    lz_receive_value: u256, allowance: u256,
) -> ByteArray {
    format_error(
        EndpointV2Error::LzReceiveValueExceedsAllowance,
        format!("LZ receive value: {}, Allowance: {}", lz_receive_value, allowance),
    )
}

pub fn err_unauthorized() -> ByteArray {
    format_error(EndpointV2Error::Unauthorized, "")
}

pub fn err_lz_token_unavailable() -> ByteArray {
    format_error(EndpointV2Error::LzTokenUnavailable, "")
}

pub fn err_zero_lz_token_fee() -> ByteArray {
    format_error(EndpointV2Error::ZeroLzTokenFee, "")
}

pub fn err_insufficient_fee(
    required_native_fee: u256,
    supplied_native_fee_allowance: u256,
    supplied_native_balance: u256,
    required_zro_token_fee: u256,
    supplied_zro_fee_allowance: u256,
    supplied_zro_balance: u256,
) -> ByteArray {
    format_error(
        EndpointV2Error::InsufficientFee,
        format!(
            "Required native fee: {}, Supplied native fee allowance: {}, Supplied native balance: {}, Required zro fee: {}, Supplied zro fee allowance: {}, Supplied zro balance: {}",
            required_native_fee,
            supplied_native_fee_allowance,
            supplied_native_balance,
            required_zro_token_fee,
            supplied_zro_fee_allowance,
            supplied_zro_balance,
        ),
    )
}

pub fn err_native_transfer_failed() -> ByteArray {
    format_error(EndpointV2Error::NativeTransferFailed, "")
}

pub fn err_zro_transfer_failed() -> ByteArray {
    format_error(EndpointV2Error::ZroTransferFailed, "")
}

pub fn err_invalid_lz_token_address(lz_token_address: ContractAddress) -> ByteArray {
    format_error(
        EndpointV2Error::InvalidLzTokenAddress, format!("Lz token address: {:?}", lz_token_address),
    )
}
