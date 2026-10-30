//! Simple message library component implementation

#[starknet::contract]
pub mod SimpleMessageLib {
    use lz_utils::bytes::Bytes32;
    use lz_utils::error::assert_with_byte_array;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};
    use crate::Origin;
    use crate::common::packet_v1_codec::PacketV1Codec;
    use crate::common::structs::messaging::{
        MessageLibSendResult, MessageReceipt, MessagingFee, Payee,
    };
    use crate::common::structs::packet::Packet;
    use crate::endpoint::interfaces::endpoint_v2::{
        IEndpointV2Dispatcher, IEndpointV2DispatcherTrait,
    };
    use crate::message_lib::interface::{IMessageLib, VerificationState};
    use crate::message_lib::sml::errors::err_only_whitelist_caller;
    use crate::message_lib::sml::events::{PacketSent, PacketVerified};
    use crate::message_lib::structs::{MessageLibType, MessageLibVersion, SetConfigParam};

    const DEFAULT_NATIVE_FEE: u256 = 1000_u256;
    const DEFAULT_LZ_TOKEN_FEE: u256 = 999_u256;

    const PAYEE_1: ContractAddress = 'payee1'.try_into().unwrap();
    const PAYEE_2: ContractAddress = 'payee2'.try_into().unwrap();

    #[derive(Drop, starknet::Store)]
    enum MockPayeeType {
        #[default]
        Native,
        LzToken,
        MixedToken,
    }

    #[storage]
    struct Storage {
        send_call_count: u64,
        should_fail: bool,
        mock_payees_type: Option<MockPayeeType>,
        endpoint: ContractAddress,
        native_fee: u256,
        lz_token_fee: u256,
        whitelist_caller: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PacketSent: PacketSent,
        PacketVerified: PacketVerified,
    }

    #[constructor]
    fn constructor(ref self: ContractState, endpoint: ContractAddress) {
        self.send_call_count.write(0);
        self.should_fail.write(false);
        self.mock_payees_type.write(None);
        self.endpoint.write(endpoint);
        self.native_fee.write(DEFAULT_NATIVE_FEE);
        self.lz_token_fee.write(DEFAULT_LZ_TOKEN_FEE);
    }

    #[abi(embed_v0)]
    impl SimpleMessageLibImpl of IMessageLib<ContractState> {
        fn send(
            ref self: ContractState, packet: Packet, options: ByteArray, pay_in_lz_token: bool,
        ) -> MessageLibSendResult {
            // Increment call count
            let count = self.send_call_count.read();
            self.send_call_count.write(count + 1);

            // Check if we should simulate failure
            assert_with_byte_array(!self.should_fail.read(), self.get_message_lib_failure());

            let payees = match self.mock_payees_type.read() {
                Some(MockPayeeType::Native) => self.get_mock_payees(),
                Some(MockPayeeType::LzToken) => self.get_mock_lz_payees(),
                Some(MockPayeeType::MixedToken) => self.get_mock_mixed_payees(),
                None => array![],
            };

            self
                .emit(
                    PacketSent {
                        nonce: packet.nonce,
                        src_eid: packet.src_eid,
                        sender: packet.sender,
                        dst_eid: packet.dst_eid,
                        receiver: packet.receiver,
                        guid: packet.guid,
                    },
                );

            MessageLibSendResult {
                message_receipt: MessageReceipt { guid: packet.guid, nonce: packet.nonce, payees },
                encoded_packet: self.get_encoded_packet_data(),
            }
        }

        fn verify(
            ref self: ContractState,
            packet_header: ByteArray,
            payload_hash: Bytes32,
            confirmations: u64,
        ) {
            // There is no actual verification.

            self
                .emit(
                    PacketVerified {
                        nonce: PacketV1Codec::nonce(@packet_header),
                        src_eid: PacketV1Codec::src_eid(@packet_header),
                        sender: PacketV1Codec::sender(@packet_header),
                        dst_eid: PacketV1Codec::dst_eid(@packet_header),
                        receiver: PacketV1Codec::receiver_address(@packet_header),
                    },
                );
        }

        fn commit(ref self: ContractState, packet_header: ByteArray, payload_hash: Bytes32) {
            assert_with_byte_array(
                get_caller_address() == self.whitelist_caller.read(), err_only_whitelist_caller(),
            );

            let receiver = PacketV1Codec::receiver_address(@packet_header);
            let src_eid = PacketV1Codec::src_eid(@packet_header);
            let nonce = PacketV1Codec::nonce(@packet_header);
            let sender = PacketV1Codec::sender(@packet_header);

            let origin = Origin { src_eid, sender, nonce };

            let endpoint_dispatcher = IEndpointV2Dispatcher {
                contract_address: self.endpoint.read(),
            };

            endpoint_dispatcher.verify(origin, receiver, payload_hash);
        }

        fn quote(
            self: @ContractState, packet: Packet, options: ByteArray, pay_in_lz_token: bool,
        ) -> MessagingFee {
            MessagingFee {
                native_fee: self.native_fee.read(),
                lz_token_fee: if pay_in_lz_token {
                    self.lz_token_fee.read()
                } else {
                    0
                },
            }
        }

        fn version(self: @ContractState) -> MessageLibVersion {
            MessageLibVersion { minor: 0, major: 0, endpoint_version: 2 }
        }

        fn message_lib_type(self: @ContractState) -> MessageLibType {
            MessageLibType::SendAndReceive
        }

        fn is_supported_send_eid(self: @ContractState, dst_eid: u32) -> bool {
            // SimpleMessageLib supports all EIDs for testing
            true
        }

        fn is_supported_receive_eid(self: @ContractState, src_eid: u32) -> bool {
            // SimpleMessageLib supports all EIDs for testing
            true
        }

        fn set_send_configs(
            ref self: ContractState, oapp: ContractAddress, params: Array<SetConfigParam>,
        ) { // SimpleMessageLib doesn't need configuration for testing
        }

        fn get_send_config(
            self: @ContractState, eid: u32, oapp: ContractAddress, config_type: u32,
        ) -> Array<felt252> {
            // Return empty config for SimpleMessageLib
            array![]
        }

        fn set_receive_configs(
            ref self: ContractState, oapp: ContractAddress, params: Array<SetConfigParam>,
        ) { // SimpleMessageLib doesn't need configuration for testing
        }

        fn get_receive_config(
            self: @ContractState, eid: u32, oapp: ContractAddress, config_type: u32,
        ) -> Array<felt252> {
            // Return empty config for SimpleMessageLib
            array![]
        }

        fn verifiable(
            self: @ContractState, packet_header: ByteArray, payload_hash: Bytes32,
        ) -> VerificationState {
            VerificationState::Verifiable
        }
    }

    // Helper interface trait definition
    #[starknet::interface]
    pub trait ISimpleMessageLibHelpers<TContractState> {
        fn set_should_fail(ref self: TContractState, should_fail: bool);
        fn set_use_mock_payees(ref self: TContractState);
        fn set_use_mock_lz_payees(ref self: TContractState);
        fn set_use_mock_mixed_payees(ref self: TContractState);
        fn disable_mock_payees(ref self: TContractState);
        fn get_send_call_count(self: @TContractState) -> u64;
        fn get_native_fee(self: @TContractState) -> u256;
        fn get_lz_token_fee(self: @TContractState) -> u256;
        fn set_native_fee(ref self: TContractState, fee: u256);
        fn set_lz_token_fee(ref self: TContractState, fee: u256);
        fn get_mock_payees(self: @TContractState) -> Array<Payee>;
        fn get_mock_lz_payees(self: @TContractState) -> Array<Payee>;
        fn get_mock_mixed_payees(self: @TContractState) -> Array<Payee>;
        fn get_encoded_packet_data(self: @TContractState) -> ByteArray;
        fn get_message_lib_failure(self: @TContractState) -> ByteArray;
        fn set_whitelist_caller(ref self: TContractState, caller: ContractAddress);
    }

    // Helper functions for testing
    #[abi(embed_v0)]
    impl SimpleMessageLibHelpers of ISimpleMessageLibHelpers<ContractState> {
        fn set_should_fail(ref self: ContractState, should_fail: bool) {
            self.should_fail.write(should_fail);
        }

        fn set_use_mock_payees(ref self: ContractState) {
            self.mock_payees_type.write(Some(MockPayeeType::Native));
        }

        fn set_use_mock_lz_payees(ref self: ContractState) {
            self.mock_payees_type.write(Some(MockPayeeType::LzToken));
        }

        fn set_use_mock_mixed_payees(ref self: ContractState) {
            self.mock_payees_type.write(Some(MockPayeeType::MixedToken));
        }

        fn disable_mock_payees(ref self: ContractState) {
            self.mock_payees_type.write(None);
        }

        fn get_send_call_count(self: @ContractState) -> u64 {
            self.send_call_count.read()
        }

        fn get_native_fee(self: @ContractState) -> u256 {
            self.native_fee.read()
        }

        fn get_lz_token_fee(self: @ContractState) -> u256 {
            self.lz_token_fee.read()
        }

        fn set_native_fee(ref self: ContractState, fee: u256) {
            self.native_fee.write(fee)
        }

        fn set_lz_token_fee(ref self: ContractState, fee: u256) {
            self.lz_token_fee.write(fee)
        }

        fn get_mock_payees(self: @ContractState) -> Array<Payee> {
            let native_fee = self.native_fee.read();
            let native_amount = native_fee / 2;

            array![
                Payee { receiver: PAYEE_1, native_amount, lz_token_amount: 0 },
                Payee {
                    receiver: PAYEE_2,
                    native_amount: native_fee - native_amount,
                    lz_token_amount: 0,
                },
            ]
        }

        fn get_mock_lz_payees(self: @ContractState) -> Array<Payee> {
            let lz_token_fee = self.lz_token_fee.read();
            let amount = lz_token_fee / 2;

            array![
                Payee { receiver: PAYEE_1, native_amount: 0, lz_token_amount: amount },
                Payee {
                    receiver: PAYEE_2, native_amount: 0, lz_token_amount: lz_token_fee - amount,
                },
            ]
        }

        fn get_mock_mixed_payees(self: @ContractState) -> Array<Payee> {
            array![
                Payee {
                    receiver: PAYEE_1, native_amount: self.native_fee.read(), lz_token_amount: 0,
                },
                Payee {
                    receiver: PAYEE_2, native_amount: 0, lz_token_amount: self.lz_token_fee.read(),
                },
            ]
        }

        fn get_encoded_packet_data(self: @ContractState) -> ByteArray {
            "mock_encoded_packet_data"
        }

        fn get_message_lib_failure(self: @ContractState) -> ByteArray {
            "Mock message library failure"
        }

        fn set_whitelist_caller(ref self: ContractState, caller: ContractAddress) {
            self.whitelist_caller.write(caller);
        }
    }
}
