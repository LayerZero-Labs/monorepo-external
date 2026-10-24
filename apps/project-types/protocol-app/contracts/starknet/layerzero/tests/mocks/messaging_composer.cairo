//! Mock messaging composer contract

#[starknet::contract]
pub mod MockMessagingComposer {
    use layerzero::common::constants::ZERO_ADDRESS;
    use layerzero::endpoint::messaging_composer::events::{ComposeDelivered, LzComposeAlert};
    use layerzero::endpoint::messaging_composer::interface::IMessagingComposer;
    use layerzero::endpoint::messaging_composer::messaging_composer::MessagingComposerComponent;
    use layerzero::endpoint::messaging_composer::messaging_composer::MessagingComposerComponent::Event as MessagingComposerEvent;
    use lz_utils::bytes::Bytes32;
    use starknet::ContractAddress;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};

    component!(
        path: MessagingComposerComponent,
        storage: messaging_composer,
        event: MessagingComposerEvent,
    );

    impl MessagingComposerInternalImpl = MessagingComposerComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        /// Whether the messaging composer is real or mock
        is_real: bool,
        /// Whether the messaging composer should fail to compose
        should_compose_fail: bool,
        #[substorage(v0)]
        messaging_composer: MessagingComposerComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        MessagingComposerEvent: MessagingComposerComponent::Event,
    }

    #[constructor]
    fn constructor(ref self: ContractState, token_address: ContractAddress) {
        self.is_real.write(true);
        self.should_compose_fail.write(false);
        self.messaging_composer.initializer(token_address);
    }

    #[abi(embed_v0)]
    pub impl MockMessagingComposerImpl of IMessagingComposer<ContractState> {
        /// Delegate to messaging composer
        fn send_compose(
            ref self: ContractState,
            to: ContractAddress,
            guid: Bytes32,
            index: u16,
            message: ByteArray,
        ) {
            self.messaging_composer.send_compose(to, guid, index, message);
        }

        /// If the messaging composer is in mock mode:
        ///
        /// - if `should_compose_fail` is true, emit LzComposeAlert event
        ///
        /// - otherwise, emit ComposeDelivered event
        fn lz_compose(
            ref self: ContractState,
            from: ContractAddress,
            to: ContractAddress,
            guid: Bytes32,
            index: u16,
            message: ByteArray,
            extra_data: ByteArray,
            value: u256,
        ) {
            if self.is_real.read() {
                self
                    .messaging_composer
                    .lz_compose(from, to, guid, index, message.clone(), extra_data.clone(), value);
            }

            // Mock messaging composer
            if self.should_compose_fail.read() {
                let reason = array!['MockComposer: lz_compose failed'];
                self.lz_compose_alert(from, to, guid, index, 0, value, message, extra_data, reason);
            } else {
                self
                    .emit(
                        MessagingComposerEvent::ComposeDelivered(
                            ComposeDelivered { from, to, guid, index },
                        ),
                    );
            }
        }

        /// If mock messaging composer - emit LzComposeAlert event
        fn lz_compose_alert(
            ref self: ContractState,
            from: ContractAddress,
            to: ContractAddress,
            guid: Bytes32,
            index: u16,
            gas: u256,
            value: u256,
            message: ByteArray,
            extra_data: ByteArray,
            reason: Array<felt252>,
        ) {
            if self.is_real.read() {
                self
                    .messaging_composer
                    .lz_compose_alert(
                        from,
                        to,
                        guid,
                        index,
                        gas,
                        value,
                        message.clone(),
                        extra_data.clone(),
                        reason.clone(),
                    );
            }

            // Mock messaging composer
            self
                .emit(
                    MessagingComposerEvent::LzComposeAlert(
                        LzComposeAlert {
                            from,
                            to,
                            executor: ZERO_ADDRESS,
                            guid,
                            index,
                            gas,
                            value,
                            message,
                            extra_data,
                            reason,
                        },
                    ),
                );
        }

        fn get_compose_queue(
            self: @ContractState,
            from: ContractAddress,
            to: ContractAddress,
            guid: Bytes32,
            index: u16,
        ) -> Bytes32 {
            self.messaging_composer.get_compose_queue(from, to, guid, index)
        }
    }

    /// Mock messaging composer helpers
    #[starknet::interface]
    pub trait MockMessagingComposerHelpers<TContractState> {
        fn set_is_real(ref self: TContractState, is_real: bool);
        fn set_should_compose_fail(ref self: TContractState, should_fail: bool);
    }

    #[abi(embed_v0)]
    pub impl MockMessagingComposerHelpersImpl of MockMessagingComposerHelpers<ContractState> {
        fn set_is_real(ref self: ContractState, is_real: bool) {
            self.is_real.write(is_real);
        }

        fn set_should_compose_fail(ref self: ContractState, should_fail: bool) {
            self.should_compose_fail.write(should_fail);
        }
    }
}
