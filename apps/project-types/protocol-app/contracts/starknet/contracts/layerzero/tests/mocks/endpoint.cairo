//! Mock endpoint component for testing

#[starknet::contract]
pub mod MockEndpointV2 {
    use layerzero::MessagingFee;
    use layerzero::common::structs::messaging::{MessageReceipt, MessagingParams, Payee};
    use layerzero::common::structs::packet::Origin;
    use layerzero::endpoint::events::{LzReceiveAlert, PacketDelivered};
    use layerzero::endpoint::interfaces::endpoint_v2::{ExecutionState, IEndpointV2};
    use lz_utils::bytes::Bytes32;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};

    #[storage]
    struct Storage {
        message_count: u64,
        eid: u32,
        receive_should_fail: bool,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        LzReceiveAlert: LzReceiveAlert,
        PacketDelivered: PacketDelivered,
    }

    #[constructor]
    fn constructor(ref self: ContractState, eid: u32) {
        self.message_count.write(0);
        self.eid.write(eid);
        self.receive_should_fail.write(false);
    }

    #[abi(embed_v0)]
    impl MockEndpointV2Impl of IEndpointV2<ContractState> {
        fn send(
            ref self: ContractState, params: MessagingParams, refund_address: ContractAddress,
        ) -> MessageReceipt {
            // Just increment the counter
            let count = self.message_count.read();
            self.message_count.write(count + 1);

            // Return a mock receipt
            MessageReceipt {
                guid: Bytes32 { value: count.into() }, nonce: count, payees: self.get_mock_payees(),
            }
        }

        /// Mock implementation
        ///
        /// - if `receive_should_fail` is false, emit PacketDelivered event
        ///
        /// - otherwise emit LzReceiveAlert event with empty reason
        fn lz_receive(
            ref self: ContractState,
            origin: Origin,
            receiver: ContractAddress,
            guid: Bytes32,
            message: ByteArray,
            extra_data: ByteArray,
            value: u256,
        ) {
            if self.receive_should_fail.read() {
                self
                    .lz_receive_alert(
                        origin,
                        receiver,
                        guid,
                        0,
                        value,
                        message,
                        extra_data,
                        array!['Mock receive failed'],
                    );
            } else {
                self.emit(PacketDelivered { origin, receiver });
            }
        }

        /// Mock implementation - emit LzReceiveAlert event
        fn lz_receive_alert(
            ref self: ContractState,
            origin: Origin,
            receiver: ContractAddress,
            guid: Bytes32,
            gas: u256,
            value: u256,
            message: ByteArray,
            extra_data: ByteArray,
            reason: Array<felt252>,
        ) {
            let executor = get_caller_address();
            self
                .emit(
                    LzReceiveAlert {
                        origin, receiver, executor, guid, gas, value, message, extra_data, reason,
                    },
                );
        }

        /// Mock implementation - do nothing
        fn clear(
            ref self: ContractState,
            origin: Origin,
            receiver: ContractAddress,
            guid: Bytes32,
            message: ByteArray,
        ) {}

        /// Mock implementation - do nothing
        fn verify(
            ref self: ContractState,
            origin: Origin,
            receiver: ContractAddress,
            payload_hash: Bytes32,
        ) {}

        fn quote(
            self: @ContractState, params: MessagingParams, sender: ContractAddress,
        ) -> MessagingFee {
            Default::default()
        }

        fn get_lz_token(self: @ContractState) -> ContractAddress {
            'lz_token'.try_into().unwrap()
        }

        /// Mock implementation - do nothing
        fn set_lz_token(ref self: ContractState, lz_token_address: ContractAddress) {}

        fn get_eid(self: @ContractState) -> u32 {
            self.eid.read()
        }

        fn set_delegate(ref self: ContractState, delegate: ContractAddress) {}

        fn get_delegate(self: @ContractState, oapp: ContractAddress) -> ContractAddress {
            'delegate'.try_into().unwrap()
        }

        fn initializable(self: @ContractState, origin: Origin, receiver: ContractAddress) -> bool {
            true
        }

        fn verifiable(self: @ContractState, origin: Origin, receiver: ContractAddress) -> bool {
            true
        }

        fn verifiable_with_receive_lib(
            self: @ContractState,
            origin: Origin,
            receiver: ContractAddress,
            receive_lib: ContractAddress,
        ) -> bool {
            true
        }

        fn executable(
            self: @ContractState, origin: Origin, receiver: ContractAddress,
        ) -> ExecutionState {
            ExecutionState::Executable
        }
    }

    #[starknet::interface]
    pub trait MockEndpointV2Helpers<TContractState> {
        fn set_receive_should_fail(ref self: TContractState, receive_should_fail: bool);
        fn get_message_count(self: @TContractState) -> u64;
        fn get_mock_payees(self: @TContractState) -> Array<Payee>;
        fn get_mock_native_fee(self: @TContractState) -> u256;
    }

    // Helper functions for testing
    #[abi(embed_v0)]
    pub impl MockEndpointV2HelpersImpl of MockEndpointV2Helpers<ContractState> {
        fn set_receive_should_fail(ref self: ContractState, receive_should_fail: bool) {
            self.receive_should_fail.write(receive_should_fail);
        }

        fn get_message_count(self: @ContractState) -> u64 {
            self.message_count.read()
        }

        fn get_mock_payees(self: @ContractState) -> Array<Payee> {
            array![
                Payee {
                    receiver: 0x1.try_into().unwrap(),
                    native_amount: self.get_mock_native_fee(),
                    lz_token_amount: 0,
                },
            ]
        }

        fn get_mock_native_fee(self: @ContractState) -> u256 {
            1000
        }
    }
}
