//! Executor Fee Library contract implementation

/// # Executor Fee Library contract
///
/// This contract handles fee calculations for executor operations, separated from the main executor
/// logic to provide modularity and easier maintenance of fee-related functionality.
#[starknet::contract]
pub mod ExecutorFeeLib {
    use lz_utils::error::assert_with_byte_array;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
    use starknet::ContractAddress;
    use starknet::storage::StoragePointerWriteAccess;
    use crate::common::constants::MAX_V1_EID;
    use crate::workers::common::{
        apply_premium_and_floor_margin, convert_and_apply_premium_to_value,
    };
    use crate::workers::executor::errors::{err_eid_not_supported, err_transfer_failed};
    use crate::workers::executor::fee_lib::interface::{FeeParams, IExecutorFeeLib};
    use crate::workers::executor::options::_decode_executor_options;
    use crate::workers::executor::structs::DstConfig;
    use crate::workers::price_feed::interface::{
        ILayerZeroPriceFeedDispatcher, ILayerZeroPriceFeedDispatcherTrait,
    };

    ////////////////
    // Components //
    ////////////////

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    ////////////////
    // Embeddings //
    ////////////////

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        /// Local endpoint ID v2
        local_eid_v2: u32,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[constructor]
    fn constructor(ref self: ContractState, local_eid_v2: u32, owner: ContractAddress) {
        // Initialize ownable component
        self.ownable.initializer(owner);

        // Set immutable values
        self.local_eid_v2.write(local_eid_v2);
    }

    #[abi(embed_v0)]
    impl ExecutorFeeLibImpl of IExecutorFeeLib<ContractState> {
        // ================================== Only Owner =====================================

        fn withdraw_token(
            ref self: ContractState,
            token_address: ContractAddress,
            to: ContractAddress,
            amount: u256,
        ) {
            self.ownable.assert_only_owner();
            let token = IERC20Dispatcher { contract_address: token_address };

            // NOTE: (from https://docs.openzeppelin.com/contracts-cairo/2.0.0/api/erc20)
            // transfer, transfer_from and approve will never return anything different from true
            // because they will revert on any error.
            let success = token.transfer(to, amount);
            assert_with_byte_array(success, err_transfer_failed());
        }

        // ================================== External =====================================

        fn get_fee_on_send(
            ref self: ContractState, params: FeeParams, dst_config: DstConfig, options: ByteArray,
        ) -> u256 {
            self.get_fee(params, dst_config, options)
        }

        // ================================== View =====================================

        fn get_fee(
            self: @ContractState, params: FeeParams, dst_config: DstConfig, options: ByteArray,
        ) -> u256 {
            // Check if destination is supported
            assert_with_byte_array(dst_config.lz_receive_base_gas != 0, err_eid_not_supported());

            // Decode executor options
            let price_feed_params = _decode_executor_options(
                false,
                self._is_v1_eid(params.dst_eid),
                dst_config.lz_receive_base_gas.into(),
                dst_config.lz_compose_base_gas.into(),
                dst_config.native_cap,
                @options,
            );

            // Get price feed estimate
            let price_feed = ILayerZeroPriceFeedDispatcher { contract_address: params.price_feed };
            let estimated_fee = price_feed
                .estimate_fee_by_eid(
                    params.dst_eid, params.calldata_size, price_feed_params.total_gas,
                );

            // Apply premium to gas fee
            let mut fee = apply_premium_and_floor_margin(
                estimated_fee.gas_fee,
                dst_config.multiplier_bps,
                params.default_multiplier_bps,
                dst_config.floor_margin_usd,
                estimated_fee.native_price_usd,
            );

            // Apply premium to value
            fee +=
                convert_and_apply_premium_to_value(
                    price_feed_params.total_value,
                    estimated_fee.price_ratio,
                    estimated_fee.price_ratio_denominator,
                    dst_config.multiplier_bps,
                    params.default_multiplier_bps,
                );

            fee
        }

        fn version(self: @ContractState) -> (u64, u8) {
            (1, 1)
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// Check if EID is v1 (endpoint v1)
        ///
        /// # Arguments
        ///
        /// * `eid` - The endpoint ID to check
        ///
        /// # Returns
        ///
        /// * `bool` - True if the EID is of an endpoint v1, false otherwise
        fn _is_v1_eid(self: @ContractState, eid: u32) -> bool {
            eid < MAX_V1_EID
        }
    }
}
