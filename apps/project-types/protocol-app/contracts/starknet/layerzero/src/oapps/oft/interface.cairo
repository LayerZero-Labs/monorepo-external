//! OFT interface

use starknet::ContractAddress;
use crate::common::structs::messaging::MessagingFee;
use crate::oapps::oft::structs::{OFTQuote, OFTSendResult, OFTVersion, SendParam};

/// IOFT defines the complete interface for Omnichain Fungible Token communication.
/// This interface provides comprehensive OFT functionality including quotes, limits, and receipts.
#[starknet::interface]
pub trait IOFT<TContractState> {
    /// Retrieves interfaceID and the version of the OFT.
    ///
    /// Returns:
    /// - OFTVersion: Contains interface_id and version
    ///
    /// The interface ID is '1' and version indicates onchain interface version.
    /// The version is 1 and indicates cross-chain compatibility.
    fn oft_version(self: @TContractState) -> OFTVersion;

    /// Retrieves the address of the token associated with the OFT.
    ///
    /// Returns the address of the ERC20 token implementation.
    fn token(self: @TContractState) -> ContractAddress;

    /// Indicates whether the OFT contract requires approval of the 'token()' to send.
    ///
    /// Returns true if approval of the underlying token implementation is required.
    /// Allows things like wallet implementers to determine integration requirements.
    fn approval_required(self: @TContractState) -> bool;

    /// Retrieves the shared decimals of the OFT.
    ///
    /// Returns the shared decimals of the OFT.
    fn shared_decimals(self: @TContractState) -> u8;

    /// Retrieves the decimal conversion rate of the OFT.
    ///
    /// Returns the decimal conversion rate of the OFT.
    fn decimal_conversion_rate(self: @TContractState) -> u256;

    /// Retrieves the address of the msg inspector.
    ///
    /// Returns the address of the msg inspector.
    fn msg_inspector(self: @TContractState) -> ContractAddress;

    /// Sets the address of the msg inspector.
    ///
    /// Args:
    /// - `msg_inspector`: The address of the msg inspector
    fn set_msg_inspector(ref self: TContractState, msg_inspector: ContractAddress);

    /// Provides a quote for OFT-related operations.
    ///
    /// Args:
    /// - `send_param`: The parameters for the send operation
    ///
    /// Returns:
    /// - OFTQuote: Contains limit, oft_fee_details, and receipt
    fn quote_oft(self: @TContractState, send_param: SendParam) -> OFTQuote;

    /// Provides a quote for the send() operation.
    ///
    /// Args:
    /// - `send_param`: The parameters for the send() operation
    /// - `pay_in_lz_token`: Flag indicating whether the caller is paying in the LZ token
    ///
    /// Returns the calculated LayerZero messaging fee from the send() operation.
    fn quote_send(
        self: @TContractState, send_param: SendParam, pay_in_lz_token: bool,
    ) -> MessagingFee;

    /// Executes the send() operation.
    ///
    /// Args:
    /// - `send_param`: The parameters for the send operation
    /// - `fee`: The fee information supplied by the caller
    /// - `refund_address`: The address to receive any excess funds from fees etc. on the src
    ///
    /// Returns:
    /// - OFTSendResult: Contains message_receipt and oft_receipt
    fn send(
        ref self: TContractState,
        send_param: SendParam,
        fee: MessagingFee,
        refund_address: ContractAddress,
    ) -> OFTSendResult;
}
