//! DVN Fee Library contract implementation

/// DVN Fee Library contract
///
/// This contract handles fee calculations for DVN operations, separated from the main DVN logic
/// to provide modularity and easier maintenance of fee-related functionality.
#[starknet::contract]
pub mod DvnFeeLib {
    use core::num::traits::Zero;
    use lz_utils::error::assert_with_byte_array;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
    use starknet::ContractAddress;
    use starknet::storage::StoragePointerWriteAccess;
    use crate::workers::common::apply_premium_and_floor_margin;
    use crate::workers::dvn::constants::{EXECUTE_FIXED_BYTES, SIGNATURE_RAW_BYTES, VERIFY_BYTES};
    use crate::workers::dvn::errors::{
        err_eid_not_supported, err_invalid_dvn_options, err_transfer_failed,
    };
    use crate::workers::dvn::fee_lib::interface::{FeeParams, IDvnFeeLib};
    use crate::workers::dvn::structs::DstConfig;
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
    impl DvnFeeLibImpl of IDvnFeeLib<ContractState> {
        // ================================== Only Owner =====================================

        fn withdraw_token(
            ref self: ContractState,
            token_address: ContractAddress,
            to: ContractAddress,
            amount: u256,
        ) {
            self.ownable.assert_only_owner();
            let token = IERC20Dispatcher { contract_address: token_address };

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
            assert_with_byte_array(dst_config.gas > 0, err_eid_not_supported(params.dst_eid));

            // Validate options (currently just check it's empty like in original DVN)
            assert_with_byte_array(options.len().is_zero(), err_invalid_dvn_options(0));

            // NOTE: Deviation from EVM spec, we don't parse the DVN options here because
            // They're only used in pre-crime and the value is not actually used.
            // Therefore don't currently see the value in implementing the parsing logic here.

            // Calculate call data size
            let calldata_size = self._get_calldata_size(params.quorum);

            // Get price feed estimate
            let price_feed = ILayerZeroPriceFeedDispatcher { contract_address: params.price_feed };
            let estimated_fee = price_feed
                .estimate_fee_by_eid(params.dst_eid, calldata_size, dst_config.gas.into());

            // Apply premium and return
            apply_premium_and_floor_margin(
                estimated_fee.gas_fee,
                dst_config.multiplier_bps,
                params.default_multiplier_bps,
                dst_config.floor_margin_usd,
                estimated_fee.native_price_usd,
            )
        }

        fn version(self: @ContractState) -> (u64, u8) {
            (1, 1)
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// Get the call data size for the quote function
        ///
        /// # Arguments
        ///
        /// * `quorum` - The quorum for the multisig
        ///
        /// # Returns
        ///
        /// * `u32` - The call data size given the quorum amount of signatures
        fn _get_calldata_size(self: @ContractState, quorum: u32) -> u32 {
            const NUM_BYTES: u32 = 32;
            let mut total_signatures_bytes = quorum * SIGNATURE_RAW_BYTES;

            if total_signatures_bytes % NUM_BYTES != 0 {
                total_signatures_bytes = total_signatures_bytes
                    - (total_signatures_bytes % NUM_BYTES)
                    + NUM_BYTES;
            }

            EXECUTE_FIXED_BYTES + VERIFY_BYTES + total_signatures_bytes + NUM_BYTES
        }
    }
}
