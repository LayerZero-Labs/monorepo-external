//! Price feed component implementation

#[starknet::contract]
pub mod PriceFeed {
    use core::num::traits::Zero;
    use lz_utils::error::assert_with_byte_array;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
    use openzeppelin::upgrades::upgradeable::UpgradeableComponent;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ClassHash, ContractAddress, get_caller_address};
    use crate::common::constants::MAX_V1_EID;
    use crate::workers::price_feed::constants::{
        ARBITRUM_COMPRESSION_PERCENT, PRICE_RATIO_DENOMINATOR,
    };
    use crate::workers::price_feed::errors::{
        err_lz_price_feed_only_price_updater, err_lz_pricefeed_not_an_op_stack,
        err_price_ratio_denominator_zero, err_transfer_failed,
    };
    use crate::workers::price_feed::events::FeeWithdrawn;
    use crate::workers::price_feed::interface::{ILayerZeroPriceFeed, IPriceFeed};
    use crate::workers::price_feed::structs::{
        ArbitrumPriceExt, FeeEstimate, GetFeeResponse, ModelType, Price, SetEidToModelTypeParam,
        SetPriceParam, UpdatePriceExt,
    };

    // ================================ Constants =============================================

    /// Ethereum Mainnet EID
    pub const ETHEREUM_MAINNET_EID: u32 = 101;

    /// Ethereum Goerli V1 EID
    pub const ETHEREUM_GOERLI_V1_EID: u32 = 10121;

    /// Ethereum Goerli V2 EID
    pub const ETHEREUM_GOERLI_V2_EID: u32 = 20121;

    /// Ethereum Sepolia EID
    pub const ETHEREUM_SEPOLIA_EID: u32 = 10161;

    /// Optimism L1 overhead
    pub const OP_L1_OVERHEAD: u32 = 3188;

    // ================================ Components =============================================

    // Ownable component
    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    // Upgradeable component
    component!(path: UpgradeableComponent, storage: upgradeable, event: UpgradeableEvent);

    // Ownable Mixin
    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    /// Upgradeable component internal implementation
    impl UpgradeableInternalImpl = UpgradeableComponent::InternalImpl<ContractState>;

    // =============================== Storage =================================

    #[storage]
    struct Storage {
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        upgradeable: UpgradeableComponent::Storage,
        // Native Price in USD
        native_price_usd: u128,
        // Price Updater => Active
        price_updater: Map<ContractAddress, bool>,
        // Eid => Price
        default_model_price: Map<u32, Price>,
        // Eid => ModelType
        eid_to_model_type: Map<u32, ModelType>,
        // Arbitrum Price Ext
        arbitrum_price_ext: ArbitrumPriceExt,
        // Price Ratio Denominator
        price_ratio_denominator: u128,
        // Arbitrum Compression Percent
        arbitrum_compression_percent: u32,
        // EndpointV2 address
        endpoint: ContractAddress,
    }

    // =============================== Events =================================

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        UpgradeableEvent: UpgradeableComponent::Event,
        FeeWithdrawn: FeeWithdrawn,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState, owner: ContractAddress, price_updater: ContractAddress,
    ) {
        // Initialize Ownable
        self.ownable.initializer(owner);

        // Initialize Price Updater
        self.price_updater.write(price_updater, true);

        // Set price ratio denominator
        self.price_ratio_denominator.write(PRICE_RATIO_DENOMINATOR);

        // Set arbitrum compression percent
        self.arbitrum_compression_percent.write(ARBITRUM_COMPRESSION_PERCENT);
    }

    #[abi(embed_v0)]
    impl PriceFeedImpl of IPriceFeed<ContractState> {
        // ===================================== Only Owner =====================================

        fn set_price_updater(ref self: ContractState, address: ContractAddress, active: bool) {
            self.ownable.assert_only_owner();
            self.price_updater.write(address, active);
        }

        fn set_eid_to_model_type(ref self: ContractState, params: Array<SetEidToModelTypeParam>) {
            self.ownable.assert_only_owner();
            for param in params {
                self.eid_to_model_type.write(param.eid, param.model_type);
            }
        }

        fn upgrade(ref self: ContractState, new_class_hash: ClassHash) {
            self.ownable.assert_only_owner();
            self.upgradeable.upgrade(new_class_hash);
        }

        fn upgrade_and_call(
            ref self: ContractState,
            new_class_hash: ClassHash,
            selector: felt252,
            calldata: Span<felt252>,
        ) -> Span<felt252> {
            self.ownable.assert_only_owner();
            self.upgradeable.upgrade_and_call(new_class_hash, selector, calldata)
        }

        fn set_price_ratio_denominator(ref self: ContractState, denominator: u128) {
            assert_with_byte_array(denominator.is_non_zero(), err_price_ratio_denominator_zero());
            self.ownable.assert_only_owner();
            self.price_ratio_denominator.write(denominator);
        }

        fn set_arbitrum_compression_percent(ref self: ContractState, compression_percent: u32) {
            self.ownable.assert_only_owner();
            self.arbitrum_compression_percent.write(compression_percent);
        }

        fn set_endpoint(ref self: ContractState, endpoint: ContractAddress) {
            self.ownable.assert_only_owner();
            self.endpoint.write(endpoint);
        }

        fn withdraw_fee(
            ref self: ContractState,
            token_address: ContractAddress,
            to: ContractAddress,
            amount: u256,
        ) {
            self.ownable.assert_only_owner();
            let token = IERC20Dispatcher { contract_address: token_address };
            let success = token.transfer(to, amount);
            assert_with_byte_array(success, err_transfer_failed());
            self.emit(FeeWithdrawn { token_address, to, amount });
        }

        // ========================= Only Price Updater or Owner ==================================

        fn set_price(ref self: ContractState, params: Array<SetPriceParam>) {
            self._only_price_updater_or_owner();
            for param in params.into_iter() {
                self.default_model_price.write(param.eid, param.price);
            }
        }

        fn set_price_for_arbitrum(ref self: ContractState, update: UpdatePriceExt) {
            self._only_price_updater_or_owner();
            self.default_model_price.write(update.eid, update.price);
            self.arbitrum_price_ext.write(update.extend);
        }

        fn set_native_price_usd(ref self: ContractState, price: u128) {
            self._only_price_updater_or_owner();
            self.native_price_usd.write(price);
        }

        // ===================================== View =================================

        fn get_price_arbitrum_ext(self: @ContractState, eid: u32) -> ArbitrumPriceExt {
            self.arbitrum_price_ext.read()
        }

        fn get_price_updater(self: @ContractState, address: ContractAddress) -> bool {
            self.price_updater.read(address)
        }

        fn get_eid_to_model_type(self: @ContractState, eid: u32) -> ModelType {
            self.eid_to_model_type.read(eid)
        }

        fn get_arbitrum_compression_percent(self: @ContractState) -> u32 {
            self.arbitrum_compression_percent.read()
        }

        fn get_endpoint(self: @ContractState) -> ContractAddress {
            self.endpoint.read()
        }
    }

    #[abi(embed_v0)]
    impl LayerZeroPriceFeedImpl of ILayerZeroPriceFeed<ContractState> {
        fn native_price_usd(self: @ContractState) -> u128 {
            self.native_price_usd.read()
        }

        fn get_fee(self: @ContractState, dst_eid: u32, calldata_size: u256, gas: u256) -> u256 {
            0
        }

        fn get_price(self: @ContractState, eid: u32) -> Price {
            self.default_model_price.read(eid)
        }

        fn get_price_ratio_denominator(self: @ContractState) -> u128 {
            self.price_ratio_denominator.read()
        }

        fn estimate_fee_by_eid(
            self: @ContractState, dst_eid: u32, calldata_size: u32, gas: u256,
        ) -> GetFeeResponse {
            self._estimate_fee_by_eid(dst_eid, calldata_size, gas)
        }

        // ============================ External =====================================

        fn estimate_fee_on_send(
            ref self: ContractState, dst_eid: u32, calldata_size: u32, gas: u256,
        ) -> GetFeeResponse {
            self._estimate_fee_by_eid(dst_eid, calldata_size, gas)
        }
    }

    // internal
    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _only_price_updater_or_owner(self: @ContractState) {
            let caller = get_caller_address();
            let is_owner_or_price_updater = caller == self.ownable.owner()
                || self.price_updater.read(caller);

            assert_with_byte_array(
                is_owner_or_price_updater, err_lz_price_feed_only_price_updater(),
            );
        }

        /// Estimates fee with default model
        ///
        /// @param dst_eid The destination EID
        /// @param calldata_size The size of the call data
        /// @param gas The gas used
        /// @return The gas fee and the price ratio
        fn _estimate_fee_with_default_model(
            self: @ContractState, dst_eid: u32, calldata_size: u32, gas: u256,
        ) -> FeeEstimate {
            let remote_price = self.default_model_price.read(dst_eid);

            // Calculate fee on the destination chain and convert it to the source chain's token.
            // 1. `gas_for_call_data`: Gas cost for the message payload on the destination chain.
            // 2. `remote_fee`: Total fee in the destination chain's native token (e.g., wei).
            //    It's `(calldata_gas + execution_gas) * gas_price`.
            // 3. `gas_fee`: The `remote_fee` converted to the source chain's native token.
            let gas_for_call_data: u256 = calldata_size.into() * remote_price.gas_per_byte.into();
            let remote_fee: u256 = (gas_for_call_data + gas)
                * remote_price.gas_price_in_unit.into();
            let gas_fee = (remote_fee * remote_price.price_ratio.into())
                / self.price_ratio_denominator.read().into();

            FeeEstimate { gas_fee, price_ratio: remote_price.price_ratio }
        }

        fn _estimate_fee_with_arbitrum_model(
            self: @ContractState, dst_eid: u32, calldata_size: u32, gas: u256,
        ) -> FeeEstimate {
            let arbitrum_price = self.default_model_price.read(dst_eid);
            let arbitrum_price_ext = self.arbitrum_price_ext.read();

            // L1 fee
            let gas_for_l1_call_data: u256 = ((calldata_size.into()
                * self.arbitrum_compression_percent.read().into())
                / 100)
                * arbitrum_price_ext.gas_per_l1_call_data_byte.into();

            // L2 Fee
            let gas_for_l2_call_data: u256 = calldata_size.into()
                * arbitrum_price.gas_per_byte.into();
            let total_gas = gas
                + arbitrum_price_ext.gas_per_l2_tx.into()
                + gas_for_l1_call_data
                + gas_for_l2_call_data;
            let gas_fee = total_gas * arbitrum_price.gas_price_in_unit.into();
            let gas_fee = (gas_fee * arbitrum_price.price_ratio.into())
                / self.price_ratio_denominator.read().into();

            FeeEstimate { gas_fee, price_ratio: arbitrum_price.price_ratio }
        }

        fn _estimate_fee_with_optimism_model(
            self: @ContractState, dst_eid: u32, calldata_size: u32, gas: u256,
        ) -> FeeEstimate {
            let ethereum_id = self._get_l1_lookup_id_for_optimism_model(dst_eid);

            // L1 fee
            let ethereum_price = self.default_model_price.read(ethereum_id);
            let gas_for_l1_call_data: u256 = (calldata_size.into()
                * ethereum_price.gas_per_byte.into())
                + OP_L1_OVERHEAD.into();
            let l1_fee: u256 = gas_for_l1_call_data * ethereum_price.gas_price_in_unit.into();

            // L2 fee
            let optimism_price = self.default_model_price.read(dst_eid);
            let gas_for_l2_call_data: u256 = calldata_size.into()
                * optimism_price.gas_per_byte.into();
            let total_gas = gas_for_l2_call_data + gas;
            let l2_fee = total_gas * optimism_price.gas_price_in_unit.into();

            let l1_fee_in_src_price = (l1_fee * ethereum_price.price_ratio.into())
                / self.price_ratio_denominator.read().into();
            let l2_fee_in_src_price = (l2_fee * optimism_price.price_ratio.into())
                / self.price_ratio_denominator.read().into();
            let gas_fee = l1_fee_in_src_price + l2_fee_in_src_price;

            FeeEstimate { gas_fee, price_ratio: optimism_price.price_ratio }
        }

        fn _get_l1_lookup_id_for_optimism_model(self: @ContractState, l2_eid: u32) -> u32 {
            let l2_eid = l2_eid % MAX_V1_EID;
            if l2_eid == 111 {
                return ETHEREUM_MAINNET_EID;
            } else if l2_eid == 10132 {
                return ETHEREUM_GOERLI_V1_EID;
            } else if l2_eid == 20132 {
                return ETHEREUM_GOERLI_V2_EID;
            }

            assert_with_byte_array(
                self.eid_to_model_type.read(l2_eid) == ModelType::OP_STACK,
                err_lz_pricefeed_not_an_op_stack(),
            );

            if l2_eid < 10000 {
                ETHEREUM_MAINNET_EID
            } else if l2_eid < 20000 {
                ETHEREUM_SEPOLIA_EID
            } else {
                ETHEREUM_GOERLI_V2_EID
            }
        }

        fn _estimate_fee_by_eid(
            self: @ContractState, dst_eid: u32, calldata_size: u32, gas: u256,
        ) -> GetFeeResponse {
            let dst_eid = dst_eid % MAX_V1_EID;

            let model_type = self.eid_to_model_type.read(dst_eid);
            let FeeEstimate {
                gas_fee, price_ratio,
            } =
                match model_type {
                    ModelType::ARB_STACK => self
                        ._estimate_fee_with_arbitrum_model(dst_eid, calldata_size, gas),
                    ModelType::OP_STACK => self
                        ._estimate_fee_with_optimism_model(dst_eid, calldata_size, gas),
                    ModelType::DEFAULT => self
                        ._estimate_fee_with_default_model(dst_eid, calldata_size, gas),
                };

            GetFeeResponse {
                gas_fee,
                price_ratio,
                price_ratio_denominator: self.price_ratio_denominator.read(),
                native_price_usd: self.native_price_usd.read(),
            }
        }
    }
}
