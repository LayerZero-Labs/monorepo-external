//! Mock LayerZero receiver for testing
#[starknet::contract]
pub mod MockReentrantReceiver {
    use layerzero::common::structs::packet::Origin;
    use layerzero::endpoint::interfaces::endpoint_v2::{
        IEndpointV2Dispatcher, IEndpointV2DispatcherTrait,
    };
    use layerzero::endpoint::interfaces::layerzero_receiver::ILayerZeroReceiver;
    use lz_utils::bytes::Bytes32;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_contract_address};

    #[storage]
    struct Storage {
        endpoint: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, endpoint: ContractAddress) {
        self.endpoint.write(endpoint);
    }

    #[abi(embed_v0)]
    impl MockReceiverImpl of ILayerZeroReceiver<ContractState> {
        fn lz_receive(
            ref self: ContractState,
            origin: Origin,
            guid: Bytes32,
            message: ByteArray,
            executor: ContractAddress,
            extra_data: ByteArray,
            value: u256,
        ) {}

        fn allow_initialize_path(self: @ContractState, origin: Origin) -> bool {
            let address = get_contract_address();
            let endpoint = self.endpoint.read();
            let endpoint_dispatcher = IEndpointV2Dispatcher { contract_address: endpoint };
            endpoint_dispatcher.verify(origin, address, Default::default());
            true
        }

        fn next_nonce(self: @ContractState, src_eid: u32, sender: Bytes32) -> u64 {
            0
        }
    }
}
