#[starknet::contract]
pub mod MockComposerTarget {
    use layerzero::endpoint::interfaces::layerzero_composer::ILayerZeroComposer;
    use layerzero::oapps::oft::oft_compose_msg_codec::OFTComposeMsgCodec;
    use lz_utils::bytes::Bytes32;
    use starknet::ContractAddress;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};

    #[storage]
    struct Storage {
        last_from: ContractAddress,
        last_guid: Bytes32,
        last_message: ByteArray,
        last_value: u256,
        received_count: u32,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {}

    #[constructor]
    fn constructor(ref self: ContractState) {}

    #[abi(embed_v0)]
    impl ComposerImpl of ILayerZeroComposer<ContractState> {
        fn lz_compose(
            ref self: ContractState,
            from: ContractAddress,
            guid: Bytes32,
            message: ByteArray,
            executor: ContractAddress,
            extra_data: ByteArray,
            value: u256,
        ) {
            self.last_from.write(from);
            self.last_guid.write(guid);
            self.last_message.write(OFTComposeMsgCodec::compose_msg(@message));
            self.last_value.write(value);
            let count = self.received_count.read();
            self.received_count.write(count + 1);
        }
    }

    #[starknet::interface]
    pub trait IMockComposerTargetInspect<TContractState> {
        fn last_from(self: @TContractState) -> ContractAddress;
        fn last_guid(self: @TContractState) -> Bytes32;
        fn last_message(self: @TContractState) -> ByteArray;
        fn last_value(self: @TContractState) -> u256;
        fn received_count(self: @TContractState) -> u32;
    }

    #[abi(embed_v0)]
    impl InspectImpl of IMockComposerTargetInspect<ContractState> {
        fn last_from(self: @ContractState) -> ContractAddress {
            self.last_from.read()
        }

        fn last_guid(self: @ContractState) -> Bytes32 {
            self.last_guid.read()
        }

        fn last_message(self: @ContractState) -> ByteArray {
            self.last_message.read()
        }

        fn last_value(self: @ContractState) -> u256 {
            self.last_value.read()
        }

        fn received_count(self: @ContractState) -> u32 {
            self.received_count.read()
        }
    }
}
