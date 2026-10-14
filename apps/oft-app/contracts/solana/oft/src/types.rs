use anchor_lang::prelude::*;

// ================================ OFT (IOFT) ================================
// EVM alignment: IOFT.sol

/// Token custody model for the OFT.
///
/// Consuming programs store this in their runtime state; it is not part of the
/// `OftInfo` discovery entry.
#[derive(InitSpace, Clone, AnchorSerialize, AnchorDeserialize, PartialEq, Eq)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum OftType {
    /// Tokens are minted on receive and burned on send.
    BurnMint = 0,
    /// Tokens are unlocked on receive and locked on send.
    LockUnlock = 1,
}

/// Struct representing OFT receipt information.
/// EVM: OFTReceipt
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct OFTReceipt {
    /// Amount of tokens ACTUALLY debited from the sender in local decimals.
    pub amount_sent_ld: u64,
    /// Amount of tokens to be received on the remote side.
    /// In non-default implementations, this COULD differ from `amount_sent_ld`.
    pub amount_received_ld: u64,
}

/// Struct representing OFT limit information.
/// These amounts can change dynamically and are up to the specific OFT implementation.
/// EVM: OFTLimit
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct OFTLimit {
    /// Minimum amount in local decimals that can be sent to the recipient.
    pub min_amount_ld: u64,
    /// Maximum amount in local decimals that can be sent to the recipient.
    pub max_amount_ld: u64,
}

/// Struct representing OFT fee details.
/// Future-proof mechanism to provide a standardized way to communicate fees to things like a UI.
/// EVM: OFTFeeDetail
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct OFTFeeDetail {
    /// Amount of the fee in local decimals. Negative values represent rebates.
    pub fee_amount_ld: i128,
    /// Description of the fee.
    pub description: String,
}

/// Return type for the `quoteOFT` operation.
/// Provides limits, fee breakdown, and receipt data for an OFT quote.
/// EVM: IOFT.quoteOFT(SendParam calldata _sendParam) returns (OFTLimit, OFTFeeDetail[], OFTReceipt)
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct QuoteOFTResult {
    /// The OFT limit information (min/max amounts).
    pub oft_limit: OFTLimit,
    /// The details of OFT fees.
    pub oft_fee_details: Vec<OFTFeeDetail>,
    /// The OFT receipt information.
    pub oft_receipt: OFTReceipt,
}

/// Parameters for the `send()` operation.
/// Combines the EVM `SendParam` struct with `MessagingFee` fields.
/// EVM: IOFT.send(SendParam calldata _sendParam, MessagingFee calldata _fee, address
/// _refundAddress)
///
/// Note: Unlike the EVM `SendParam`, this struct does not include an `oftCmd` field.
/// Custom OFT implementations that need OFT commands should pass them via a separate PDA account.
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct SendParams {
    /// Destination endpoint ID.
    pub dst_eid: u32,
    /// Recipient address (bytes32).
    pub to: [u8; 32],
    /// Amount to send in local decimals.
    pub amount_ld: u64,
    /// Minimum amount to send in local decimals (slippage protection).
    pub min_amount_ld: u64,
    /// Additional options supplied by the caller to be used in the LayerZero message.
    pub extra_options: Vec<u8>,
    /// The composed message for the send() operation. `None` if no composed message.
    pub compose_msg: Option<Vec<u8>>,
    /// The native fee for the LayerZero message (from MessagingFee.nativeFee).
    pub native_fee: u64,
    /// The lzToken fee for the LayerZero message (from MessagingFee.lzTokenFee).
    pub lz_token_fee: u64,
}

/// Parameters for the `quoteSend()` operation.
/// Provides a quote for the send() operation.
/// EVM: IOFT.quoteSend(SendParam calldata _sendParam, bool _payInLzToken) returns (MessagingFee)
///
/// Note: Unlike the EVM `SendParam`, this struct does not include an `oftCmd` field.
/// Custom OFT implementations that need OFT commands should pass them via a separate PDA account.
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct QuoteSendParams {
    /// Destination endpoint ID.
    pub dst_eid: u32,
    /// Recipient address (bytes32).
    pub to: [u8; 32],
    /// Amount to send in local decimals.
    pub amount_ld: u64,
    /// Minimum amount to send in local decimals (slippage protection).
    pub min_amount_ld: u64,
    /// Additional options supplied by the caller to be used in the LayerZero message.
    pub extra_options: Vec<u8>,
    /// The composed message for the send() operation. `None` if no composed message.
    pub compose_msg: Option<Vec<u8>>,
    /// Flag indicating whether the caller is paying in the LZ token.
    pub pay_in_lz_token: bool,
}

/// Parameters for the `quoteOFT()` operation.
/// Describes the transfer inputs used to quote OFT limits, fees, and receipt amounts.
/// EVM: IOFT.quoteOFT(SendParam calldata _sendParam)
///
/// Note: Unlike the EVM `SendParam`, this struct does not include an `oftCmd` field.
/// Custom OFT implementations that need OFT commands should pass them via a separate PDA account.
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct QuoteOFTParams {
    /// Destination endpoint ID.
    pub dst_eid: u32,
    /// Recipient address (bytes32).
    pub to: [u8; 32],
    /// Amount to send in local decimals.
    pub amount_ld: u64,
    /// Minimum amount to send in local decimals (slippage protection).
    pub min_amount_ld: u64,
    /// Additional options supplied by the caller to be used in the LayerZero message.
    pub extra_options: Vec<u8>,
    /// The composed message for the send() operation. `None` if no composed message.
    pub compose_msg: Option<Vec<u8>>,
    /// Deprecated: retained for backward compatibility with deployed programs. Not used by the
    /// quoteOFT operation.
    pub pay_in_lz_token: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oft_type_enum_values() {
        assert_eq!(OftType::BurnMint as u8, 0);
        assert_eq!(OftType::LockUnlock as u8, 1);
    }
}
