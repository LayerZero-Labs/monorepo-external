//! Mock LayerZero receiver for testing

#[starknet::contract]
pub mod MockReceiver {
    use layerzero::common::structs::packet::Origin;
    use layerzero::endpoint::interfaces::layerzero_receiver::ILayerZeroReceiver;
    use lz_utils::bytes::Bytes32;
    use starknet::ContractAddress;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};

    #[storage]
    struct Storage {
        allow_initialize: bool,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {
        self.allow_initialize.write(true);
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
        ) { // empty LzReceive implementation for now
        }

        fn allow_initialize_path(self: @ContractState, origin: Origin) -> bool {
            self.allow_initialize.read()
        }
        fn next_nonce(self: @ContractState, src_eid: u32, sender: Bytes32) -> u64 {
            0
        }
    }

    // Helper functions for testing
    #[abi(embed_v0)]
    impl MockReceiverHelpers of IMockReceiverHelpers<ContractState> {
        fn set_allow_initialize(ref self: ContractState, allow: bool) {
            self.allow_initialize.write(allow);
        }
    }

    #[starknet::interface]
    pub trait IMockReceiverHelpers<TContractState> {
        fn set_allow_initialize(ref self: TContractState, allow: bool);
    }
}
