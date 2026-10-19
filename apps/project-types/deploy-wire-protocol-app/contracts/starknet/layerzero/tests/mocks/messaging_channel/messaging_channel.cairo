//! Mock MessagingChannel contract for testing

#[starknet::contract]
pub mod MockMessagingChannel {
    use layerzero::Origin;
    use layerzero::endpoint::messaging_channel::messaging_channel::MessagingChannelComponent;
    use lz_utils::bytes::Bytes32;
    use lz_utils::error::{Error, assert_with_byte_array, format_error};
    use starknet::ContractAddress;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use crate::mocks::messaging_channel::interface::IMockMessagingChannel;

    // === Error Definitions ===
    #[derive(Drop)]
    pub enum MockMessagingChannelError {
        NotAuthorized,
    }

    impl ErrorNameImpl of Error<MockMessagingChannelError> {
        fn prefix() -> ByteArray {
            "MOCK_MESSAGING_CHANNEL"
        }

        fn name(self: MockMessagingChannelError) -> ByteArray {
            match self {
                MockMessagingChannelError::NotAuthorized => "NOT_AUTHORIZED",
            }
        }
    }

    component!(
        path: MessagingChannelComponent, storage: messaging_channel, event: MessagingChannelEvent,
    );

    // MessagingChannel
    #[abi(embed_v0)]
    impl MessagingChannelImpl =
        MessagingChannelComponent::MessagingChannelImpl<ContractState>;
    impl MessagingChannelInternalImpl = MessagingChannelComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        throw_on_authorize: bool,
        #[substorage(v0)]
        messaging_channel: MessagingChannelComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        MessagingChannelEvent: MessagingChannelComponent::Event,
    }

    #[constructor]
    fn constructor(ref self: ContractState, eid: u32) {
        self.messaging_channel.initializer(eid);
    }

    pub fn err_not_authorized() -> ByteArray {
        format_error(MockMessagingChannelError::NotAuthorized, "")
    }

    impl MockMessagingChannelHooks of MessagingChannelComponent::MessagingChannelHooks<
        ContractState,
    > {
        fn _assert_authorized(
            self: @MessagingChannelComponent::ComponentState<ContractState>,
            receiver: ContractAddress,
        ) {
            assert_with_byte_array(
                !self.get_contract().throw_on_authorize.read(), err_not_authorized(),
            );
        }
    }

    #[abi(embed_v0)]
    impl MockMessagingChannelHelpers of IMockMessagingChannelHelpers<ContractState> {
        fn set_throw_on_authorize(ref self: ContractState, throw: bool) {
            self.throw_on_authorize.write(throw);
        }
    }

    #[starknet::interface]
    pub trait IMockMessagingChannelHelpers<TContractState> {
        fn set_throw_on_authorize(ref self: TContractState, throw: bool);
    }

    #[abi(embed_v0)]
    impl MockMessagingChannelImpl of IMockMessagingChannel<ContractState> {
        fn fake_commit(
            ref self: ContractState,
            receiver: ContractAddress,
            origin: Origin,
            payload_hash: Bytes32,
        ) {
            self
                .messaging_channel
                ._inbound_payload_hash_entry(receiver, origin.src_eid, origin.sender, origin.nonce)
                .write(payload_hash);
        }

        fn fake_send(
            ref self: ContractState, sender: ContractAddress, dst_eid: u32, receiver: Bytes32,
        ) {
            let entry = self.messaging_channel._outbound_nonce_entry(sender, dst_eid, receiver);
            entry.write(entry.read() + 1);
        }

        fn test_clear_payload(
            ref self: ContractState, receiver: ContractAddress, origin: Origin, payload: ByteArray,
        ) {
            self.messaging_channel._clear_payload(receiver, @origin, @payload);
        }

        fn test_skip(ref self: ContractState, receiver: ContractAddress, origin: Origin) {
            self.messaging_channel.skip(receiver, origin);
        }

        fn test_nilify(
            ref self: ContractState,
            receiver: ContractAddress,
            origin: Origin,
            payload_hash: Bytes32,
        ) {
            self.messaging_channel.nilify(receiver, origin, payload_hash);
        }

        fn test_burn(
            ref self: ContractState,
            receiver: ContractAddress,
            origin: Origin,
            payload_hash: Bytes32,
        ) {
            self.messaging_channel.burn(receiver, origin, payload_hash);
        }
    }
}
