use lz_utils::bytes::Bytes32;
use crate::MessageReceipt;

/// Struct representing token parameters for the OFT send() operation.
#[derive(Clone, Drop, Serde, Default)]
pub struct SendParam {
    pub dst_eid: u32, // Destination endpoint ID
    pub to: Bytes32, // Recipient address
    pub amount_ld: u256, // Amount to send in local decimals
    pub min_amount_ld: u256, // Minimum amount to send in local decimals
    pub extra_options: ByteArray, // Additional options supplied by the caller
    pub compose_msg: ByteArray, // The composed message for the send() operation
    pub oft_cmd: ByteArray // The OFT command to be executed
}

/// Struct representing OFT limit information.
/// These amounts can change dynamically and are up to the specific oft implementation.
#[derive(Debug, Drop, Serde, Default, PartialEq)]
pub struct OFTLimit {
    pub min_amount_ld: u256, // Minimum amount in local decimals that can be sent
    pub max_amount_ld: u256 // Maximum amount in local decimals that can be sent
}

/// Struct representing OFT receipt information.
#[derive(Debug, Drop, Serde, Default, PartialEq)]
pub struct OFTReceipt {
    pub amount_sent_ld: u256, // Amount of tokens ACTUALLY debited from the sender in local decimals
    pub amount_received_ld: u256 // Amount of tokens to be received on the remote side
}

/// Struct representing OFT fee details.
/// Future proof mechanism to provide a standardized way to communicate fees to things like a UI.
#[derive(Debug, Drop, Serde, Default, PartialEq)]
pub struct OFTFeeDetail {
    pub fee_amount_ld: u256, // Amount of the fee in local decimals
    pub reward_amount_ld: u256, // Amount of the reward in local decimals
    pub description: ByteArray // Description of the fee
}

/// Struct representing OFT version information.
#[derive(Drop, Serde, Default)]
pub struct OFTVersion {
    pub interface_id: u32, // The interface ID (equivalent to Solidity's bytes4)
    pub version: u64 // The version number
}

/// Struct representing OFT quote information.
#[derive(Debug, Drop, Serde, Default, PartialEq)]
pub struct OFTQuote {
    pub limit: OFTLimit, // The OFT limit information
    pub oft_fee_details: Array<OFTFeeDetail>, // The details of OFT fees
    pub receipt: OFTReceipt // The OFT receipt information
}

/// Struct representing OFT send result.
#[derive(Drop, Serde, Default)]
pub struct OFTSendResult {
    pub message_receipt: MessageReceipt, // The LayerZero messaging receipt
    pub oft_receipt: OFTReceipt // The OFT receipt information
}

#[derive(Drop, Serde, Default)]
pub struct OFTDebit {
    pub amount_sent_ld: u256, // Amount of tokens ACTUALLY debited from the sender in local decimals
    pub amount_received_ld: u256 // Amount of tokens to be received on the remote side
}

#[derive(Drop, Serde, Default)]
pub struct OFTMsgAndOptions {
    pub message: ByteArray, // The encoded message
    pub options: ByteArray // The encoded options
}
