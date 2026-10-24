use lz_utils::error::{Error, format_error};
use starknet::EthAddress;
use starknet::secp256_trait::Signature;

#[derive(Drop)]
pub enum MultisigError {
    TotalSignersLessThanThreshold,
    OnlyMultisig,
    ZeroThreshold,
    InvalidSigner,
    SignerAlreadyAdded,
    SignerNotFound,
    SignatureError,
    UnsortedSigners,
    ThresholdGreaterThanMaxThreshold,
    InvalidSignature,
}

impl ErrorNameImpl of Error<MultisigError> {
    fn prefix() -> ByteArray {
        "LZ_MULTISIG"
    }

    fn name(self: MultisigError) -> ByteArray {
        match self {
            MultisigError::TotalSignersLessThanThreshold => "TOTAL_SIGNERS_LESS_THAN_THRESHOLD",
            MultisigError::OnlyMultisig => "ONLY_MULTISIG",
            MultisigError::ZeroThreshold => "ZERO_THRESHOLD",
            MultisigError::InvalidSigner => "INVALID_SIGNER",
            MultisigError::SignerAlreadyAdded => "SIGNER_ALREADY_ADDED",
            MultisigError::SignerNotFound => "SIGNER_NOT_FOUND",
            MultisigError::SignatureError => "SIGNATURE_ERROR",
            MultisigError::UnsortedSigners => "UNSORTED_SIGNERS",
            MultisigError::ThresholdGreaterThanMaxThreshold => "THRESHOLD_GREATER_THAN_MAX_THRESHOLD",
            MultisigError::InvalidSignature => "INVALID_SIGNATURE",
        }
    }
}


/// Error messages for the Multisig component

pub fn err_total_signers_less_than_threshold(total_signers: u32, threshold: u32) -> ByteArray {
    let message = format!("total_signers: {:?}, threshold: {:?}", total_signers, threshold);
    format_error(MultisigError::TotalSignersLessThanThreshold, message)
}

pub fn err_only_multisig() -> ByteArray {
    format_error(MultisigError::OnlyMultisig, "")
}

pub fn err_zero_threshold() -> ByteArray {
    format_error(MultisigError::ZeroThreshold, "")
}

pub fn err_invalid_signer() -> ByteArray {
    format_error(MultisigError::InvalidSigner, "")
}

pub fn err_signer_already_added(signer: EthAddress) -> ByteArray {
    format_error(MultisigError::SignerAlreadyAdded, format!("signer: {:?}", signer))
}

pub fn err_signer_not_found(signer: EthAddress) -> ByteArray {
    format_error(MultisigError::SignerNotFound, format!("signer: {:?}", signer))
}

pub fn err_signature_error() -> ByteArray {
    format_error(MultisigError::SignatureError, "")
}

pub fn err_invalid_signature(signature: @Signature) -> ByteArray {
    format_error(MultisigError::InvalidSignature, format!("signature: {:?}", signature))
}

pub fn err_unsorted_signers() -> ByteArray {
    format_error(MultisigError::UnsortedSigners, "")
}

pub fn err_threshold_greater_than_max_threshold(threshold: u32) -> ByteArray {
    format_error(
        MultisigError::ThresholdGreaterThanMaxThreshold, format!("threshold: {:?}", threshold),
    )
}
