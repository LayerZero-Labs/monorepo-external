//! Mock Executor worker for testing

#[starknet::contract]
pub mod MockExecutor {
    use layerzero::Origin;
    use layerzero::common::conversions::FeltArrayIntoByteArrayImpl;
    use layerzero::endpoint::events;
    use layerzero::endpoint::interfaces::endpoint_v2::{
        IEndpointV2Dispatcher, IEndpointV2DispatcherTrait,
    };
    use layerzero::endpoint::messaging_composer::interface::{
        IMessagingComposerDispatcher, IMessagingComposerDispatcherTrait,
    };
    use layerzero::workers::base::structs::QuoteParams;
    use layerzero::workers::executor::interface::IExecutor;
    use layerzero::workers::executor::structs::{
        ComposeParams, DstConfig, ExecuteParams, NativeDropParams, SetDstConfigParams,
    };
    use layerzero::workers::interface::ILayerZeroWorker;
    use lz_utils::error::assert_with_byte_array;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ClassHash, ContractAddress};

    pub(crate) const DST_CONFIG: DstConfig = DstConfig {
        lz_receive_base_gas: 100000,
        multiplier_bps: 10000,
        floor_margin_usd: 0,
        native_cap: 1000000000000000000, // 1 ETH
        lz_compose_base_gas: 50000,
    };

    #[storage]
    struct Storage {
        quote_result: u256,
        should_fail: bool,
        endpoint: ContractAddress,
        token_address: ContractAddress,
        composer: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PacketDelivered: events::PacketDelivered,
        LzReceiveAlert: events::LzReceiveAlert,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        quote_result: u256,
        endpoint: ContractAddress,
        token_address: ContractAddress,
        composer: ContractAddress,
    ) {
        self.quote_result.write(quote_result);
        self.should_fail.write(false);
        self.endpoint.write(endpoint);
        self.token_address.write(token_address);
        self.composer.write(composer);
    }

    #[abi(embed_v0)]
    impl MockExecutorImpl of IExecutor<ContractState> {
        /// Mock implementation - do nothing
        fn pause(ref self: ContractState) {}

        /// Mock implementation - do nothing
        fn unpause(ref self: ContractState) {}

        /// Mock implementation - do nothing
        fn set_dst_config(ref self: ContractState, params: Array<SetDstConfigParams>) {}

        /// Mock implementation - return default config
        fn get_dst_config(self: @ContractState, dst_eid: u32) -> DstConfig {
            DST_CONFIG
        }

        /// Mock implementation - `lz_receive` on endpoint
        fn execute(ref self: ContractState, params: ExecuteParams) {
            IEndpointV2Dispatcher { contract_address: self.endpoint.read() }
                .lz_receive(
                    params.origin,
                    params.receiver,
                    params.guid,
                    params.message,
                    params.extra_data,
                    params.value,
                );
        }

        /// Mock implementation - `lz_compose` on messaging composer
        fn compose(ref self: ContractState, params: ComposeParams) {
            IMessagingComposerDispatcher { contract_address: self.composer.read() }
                .lz_compose(
                    params.sender,
                    params.receiver,
                    params.guid,
                    params.index,
                    params.message,
                    params.extra_data,
                    params.value,
                );
        }

        /// Mock implementation - do nothing
        fn upgrade(ref self: ContractState, new_class_hash: ClassHash) {}

        /// Mock implementation - do nothing
        fn upgrade_and_call(
            ref self: ContractState,
            new_class_hash: ClassHash,
            selector: felt252,
            calldata: Span<felt252>,
        ) -> Span<felt252> {
            array![].span()
        }

        /// Mock implementation - do nothing
        fn native_drop(
            ref self: ContractState,
            origin: Origin,
            oapp: ContractAddress,
            native_drop_params: Array<NativeDropParams>,
        ) {}

        /// Reference implementation - call the native drop and then execute functions.
        fn native_drop_and_execute(
            ref self: ContractState,
            native_drop_params: Array<NativeDropParams>,
            execute_params: ExecuteParams,
        ) {
            self
                .native_drop(
                    execute_params.origin.clone(), execute_params.receiver, native_drop_params,
                );
            self.execute(execute_params);
        }

        fn get_endpoint(self: @ContractState) -> ContractAddress {
            self.endpoint.read()
        }

        fn get_native_token_address(self: @ContractState) -> ContractAddress {
            self.token_address.read()
        }

        fn get_eid(self: @ContractState) -> u32 {
            IEndpointV2Dispatcher { contract_address: self.endpoint.read() }.get_eid()
        }
    }

    #[abi(embed_v0)]
    impl LayerZeroWorkerImpl of ILayerZeroWorker<ContractState> {
        /// Mock implementation - return quote result
        fn assign_job(ref self: ContractState, params: QuoteParams) -> u256 {
            assert_with_byte_array(!self.should_fail.read(), "MockExecutor: quote failed");

            self.quote_result.read()
        }

        fn quote(self: @ContractState, params: QuoteParams) -> u256 {
            assert_with_byte_array(!self.should_fail.read(), "MockExecutor: quote failed");

            self.quote_result.read()
        }
    }

    // Helper functions for testing
    #[abi(embed_v0)]
    impl MockExecutorHelpers of IMockExecutorHelpers<ContractState> {
        fn set_quote_result(ref self: ContractState, quote_result: u256) {
            self.quote_result.write(quote_result);
        }

        fn get_quote_result(self: @ContractState) -> u256 {
            self.quote_result.read()
        }

        fn set_should_fail(ref self: ContractState, should_fail: bool) {
            self.should_fail.write(should_fail);
        }

        fn get_should_fail(self: @ContractState) -> bool {
            self.should_fail.read()
        }
    }

    #[starknet::interface]
    pub trait IMockExecutorHelpers<TContractState> {
        fn set_quote_result(ref self: TContractState, quote_result: u256);
        fn get_quote_result(self: @TContractState) -> u256;
        fn set_should_fail(ref self: TContractState, should_fail: bool);
        fn get_should_fail(self: @TContractState) -> bool;
    }
}
