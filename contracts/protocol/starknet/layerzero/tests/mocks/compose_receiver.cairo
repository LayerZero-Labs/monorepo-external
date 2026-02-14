//! A LayerZero receiver mock that triggers LZ compose.

#[starknet::contract]
pub mod MockComposeReceiver {
    use layerzero::common::structs::packet::Origin;
    use layerzero::endpoint::interfaces::layerzero_receiver::ILayerZeroReceiver;
    use layerzero::endpoint::messaging_composer::interface::{
        IMessagingComposerDispatcher, IMessagingComposerDispatcherTrait,
    };
    use lz_utils::bytes::Bytes32;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};

    #[storage]
    struct Storage {
        compose_target: ContractAddress,
        message: ByteArray,
    }

    #[constructor]
    fn constructor(ref self: ContractState, compose_target: ContractAddress, message: ByteArray) {
        self.compose_target.write(compose_target);
        self.message.write(message);
    }

    #[abi(embed_v0)]
    impl LayerZeroReceiverImpl of ILayerZeroReceiver<ContractState> {
        fn lz_receive(
            ref self: ContractState,
            origin: Origin,
            guid: Bytes32,
            message: ByteArray,
            executor: ContractAddress,
            extra_data: ByteArray,
            value: u256,
        ) {
            IMessagingComposerDispatcher { contract_address: get_caller_address() }
                .send_compose(self.compose_target.read(), guid, 0, self.message.read());
        }

        fn allow_initialize_path(self: @ContractState, origin: Origin) -> bool {
            true
        }

        fn next_nonce(self: @ContractState, src_eid: u32, sender: Bytes32) -> u64 {
            0
        }
    }
}
