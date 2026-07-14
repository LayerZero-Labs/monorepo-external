use soroban_sdk::{contracttype, Bytes, BytesN};

/// Message type for simple OFT send
pub const SEND: u32 = 1;

/// Message type for OFT send with compose functionality
pub const SEND_AND_CALL: u32 = 2;

/// Parameters for sending OFT tokens cross-chain
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct SendParam {
    /// The destination endpoint ID
    pub dst_eid: u32,
    /// The recipient address on the destination chain (32 bytes)
    pub to: BytesN<32>,
    /// The amount to send in local decimals
    pub amount_ld: i128,
    /// The minimum amount to receive in local decimals (slippage protection)
    pub min_amount_ld: i128,
    /// Additional options for the LayerZero message (Optional)
    pub extra_options: Bytes,
    /// Compose message to execute on the destination (Optional)
    pub compose_msg: Bytes,
    /// OFT command for custom behavior (Optional)
    pub oft_cmd: Bytes,
}

/// Transfer limits for OFT operations
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct OFTLimit {
    /// The minimum amount to send in local decimals
    pub min_amount_ld: i128,
    /// The maximum amount to send in local decimals
    pub max_amount_ld: i128,
}

/// Receipt containing amounts sent and received in an OFT transfer
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct OFTReceipt {
    /// The amount sent in local decimals
    pub amount_sent_ld: i128,
    /// The amount received in local decimals on the remote
    pub amount_received_ld: i128,
}

/// Details about fees charged in an OFT operation
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct OFTFeeDetail {
    /// The amount of the fee in local decimals. Positive values represent fees charged,
    /// while negative values represent rewards given.
    pub fee_amount_ld: i128,
    /// The description of the fee
    pub description: Bytes,
}
