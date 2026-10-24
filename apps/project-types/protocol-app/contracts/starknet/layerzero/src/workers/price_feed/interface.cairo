//! Price feed worker interface

use starknet::{ClassHash, ContractAddress};
use crate::workers::price_feed::structs::{
    ArbitrumPriceExt, GetFeeResponse, ModelType, Price, SetEidToModelTypeParam, SetPriceParam,
    UpdatePriceExt,
};

/// Interface for the price feed worker
#[starknet::interface]
pub trait IPriceFeed<TContractState> {
    // ===================================== Only Owner =====================================

    /// Set the price updater
    ///
    /// # Arguments
    ///
    /// * `address`: The address of the price updater
    /// * `active`: Whether the price updater is active
    ///
    /// @dev This function is only callable by the owner
    fn set_price_updater(ref self: TContractState, address: ContractAddress, active: bool);

    /// Set EIDs to model types
    ///
    /// # Arguments
    ///
    /// * `params`: The parameters to set the EIDs to model types
    ///
    /// @dev This function is only callable by the owner
    fn set_eid_to_model_type(ref self: TContractState, params: Array<SetEidToModelTypeParam>);

    /// Upgrade the contract
    ///
    /// # Arguments
    ///
    /// * `new_class_hash`: The class hash of the new contract
    ///
    /// @dev This function is only callable by the owner
    fn upgrade(ref self: TContractState, new_class_hash: ClassHash);

    /// Upgrade the contract and call a function
    ///
    /// # Arguments
    ///
    /// * `new_class_hash` - The new class hash to upgrade to
    /// * `selector` - The selector to call
    /// * `data` - The data to pass to the function
    ///
    /// # Returns
    ///
    /// * `Span<felt252>` - The response data from the function call
    ///
    /// # Events
    ///
    /// * `Upgraded` - Emitted when the contract is upgraded (from OpenZeppelin's
    /// [`UpgradeableComponent`])
    ///
    /// @dev This function is only callable by the owner
    fn upgrade_and_call(
        ref self: TContractState,
        new_class_hash: ClassHash,
        selector: felt252,
        calldata: Span<felt252>,
    ) -> Span<felt252>;

    /// Set the price ratio denominator
    ///
    /// # Arguments
    ///
    /// * `denominator`: The price ratio denominator
    ///
    /// @dev This function is only callable by the owner
    fn set_price_ratio_denominator(ref self: TContractState, denominator: u128);

    /// Set the arbitrum compression percent
    ///
    /// # Arguments
    ///
    /// * `compression_percent`: The arbitrum compression percent
    ///
    /// @dev This function is only callable by the owner
    fn set_arbitrum_compression_percent(ref self: TContractState, compression_percent: u32);

    /// Set the endpoint address
    ///
    /// # Arguments
    ///
    /// * `endpoint`: The endpoint address
    ///
    /// @dev This function is only callable by the owner
    fn set_endpoint(ref self: TContractState, endpoint: ContractAddress);

    /// Withdraw collected fees
    ///
    /// # Arguments
    ///
    /// * `token_address`: The address of the token to withdraw
    /// * `to`: The address to withdraw the fees to
    /// * `amount`: The amount of fees to withdraw
    ///
    /// @dev This function is only callable by the owner
    fn withdraw_fee(
        ref self: TContractState, token_address: ContractAddress, to: ContractAddress, amount: u256,
    );

    // ========================= Only Price Updater or Owner ==================================

    /// Set the price for a given EID
    ///
    /// # Arguments
    ///
    /// * `params`: The parameters to set the price
    ///
    /// @dev This function is only callable by the price updater or owner
    fn set_price(ref self: TContractState, params: Array<SetPriceParam>);

    /// Set the arbitrum price for a given EID
    ///
    /// # Arguments
    ///
    /// * `update`: The parameters to set the arbitrum price
    ///
    /// @dev This function is only callable by the price updater or owner
    fn set_price_for_arbitrum(ref self: TContractState, update: UpdatePriceExt);

    /// Set the native price in USD
    ///
    /// # Arguments
    ///
    /// * `price`: The native price in USD
    ///
    /// @dev This function is only callable by the price updater or owner
    fn set_native_price_usd(ref self: TContractState, price: u128);

    // ======================================= View ========================================

    /// Get the arbitrum price ext for a given endpoint ID
    ///
    /// # Arguments
    ///
    /// * `eid`: The endpoint ID of the destination chain
    ///
    /// # Returns
    ///
    /// `ArbitrumPriceExt` - The arbitrum price ext for the given EID
    fn get_price_arbitrum_ext(self: @TContractState, eid: u32) -> ArbitrumPriceExt;

    /// Get the price updater for a given address
    ///
    /// # Arguments
    ///
    /// * `address`: The address of the price updater
    ///
    /// # Returns
    ///
    /// `bool` - Whether the price updater is active
    fn get_price_updater(self: @TContractState, address: ContractAddress) -> bool;

    /// Get the model type for a given endpoint ID
    ///
    /// # Arguments
    ///
    /// * `eid`: The endpoint ID of the destination chain
    ///
    /// # Returns
    ///
    /// `ModelType` - The model type
    fn get_eid_to_model_type(self: @TContractState, eid: u32) -> ModelType;

    /// Get the arbitrum compression percent
    ///
    /// # Returns
    ///
    /// `u32` - The arbitrum compression percent
    fn get_arbitrum_compression_percent(self: @TContractState) -> u32;

    /// Get the endpoint address
    ///
    /// # Returns
    ///
    /// `ContractAddress` - The endpoint address
    fn get_endpoint(self: @TContractState) -> ContractAddress;
}

/// Interface for the LayerZero price feed
#[starknet::interface]
pub trait ILayerZeroPriceFeed<TContractState> {
    // ============================ View =====================================

    /// Get the native price in USD
    ///
    /// # Returns
    ///
    /// `u128` - The native price in USD
    fn native_price_usd(self: @TContractState) -> u128;

    /// Get the fee to be paid to the price feed
    ///
    /// # Arguments
    ///
    /// * `dst_eid`: The endpoint ID of the destination chain
    /// * `calldata_size`: The size of the call data
    /// * `gas`: The gas used
    ///
    /// # Returns
    ///
    /// `u256` - The fee to be paid to the price feed
    fn get_fee(self: @TContractState, dst_eid: u32, calldata_size: u256, gas: u256) -> u256;

    /// Get the price for a given EID
    ///
    /// # Arguments
    ///
    /// * `eid`: The endpoint ID of the destination chain
    ///
    /// # Returns
    ///
    /// `Price` - The price for the given EID
    fn get_price(self: @TContractState, eid: u32) -> Price;

    /// Get the price ratio denominator
    ///
    /// # Returns
    ///
    /// `u128` - The price ratio denominator
    fn get_price_ratio_denominator(self: @TContractState) -> u128;

    /// Estimate the fee for a given EID, call data size, and gas
    ///
    /// # Arguments
    ///
    /// * `dst_eid`: The endpoint ID of the destination chain
    /// * `calldata_size`: The size of the call data
    /// * `gas`: The gas used
    ///
    /// # Returns
    ///
    /// * `GetFeeResponse` - The fee estimate for the given EID, call data size, and gas
    fn estimate_fee_by_eid(
        self: @TContractState, dst_eid: u32, calldata_size: u32, gas: u256,
    ) -> GetFeeResponse;

    // ============================ External =====================================

    /// Estimate the fee on send for a given EID, call data size, and gas
    ///
    /// # Arguments
    ///
    /// * `dst_eid`: The endpoint ID of the destination chain
    /// * `calldata_size`: The size of the call data
    /// * `gas`: The gas used
    ///
    /// # Returns
    ///
    /// * `GetFeeResponse` - The fee estimate for the given EID, call data size, and gas
    fn estimate_fee_on_send(
        ref self: TContractState, dst_eid: u32, calldata_size: u32, gas: u256,
    ) -> GetFeeResponse;
}
