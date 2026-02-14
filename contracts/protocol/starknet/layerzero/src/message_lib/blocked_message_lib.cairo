/// This is a message library that is used to block all messages from being sent or received.
#[starknet::contract]
pub mod BlockedMessageLib {
    use core::num::traits::Bounded;
    use core::panics::panic_with_byte_array;
    use lz_utils::bytes::Bytes32;
    use lz_utils::error::{Error, format_error};
    use starknet::ContractAddress;
    use crate::common::structs::messaging::{MessageLibSendResult, MessagingFee};
    use crate::common::structs::packet::Packet;
    use crate::message_lib::interface::{IMessageLib, VerificationState};
    use crate::message_lib::structs::{MessageLibType, MessageLibVersion, SetConfigParam};

    // === Error Definitions ===
    #[derive(Drop)]
    pub enum BlockedMessageLibError {
        NotImplemented,
    }

    impl ErrorNameImpl of Error<BlockedMessageLibError> {
        fn prefix() -> ByteArray {
            "LZ_BLOCKED_MESSAGE_LIB"
        }

        fn name(self: BlockedMessageLibError) -> ByteArray {
            match self {
                BlockedMessageLibError::NotImplemented => "NOT_IMPLEMENTED",
            }
        }
    }

    pub fn err_not_implemented() -> ByteArray {
        format_error(BlockedMessageLibError::NotImplemented, "")
    }

    // === Storage ===
    #[storage]
    struct Storage {}

    // === Constructor ===
    #[constructor]
    fn constructor(ref self: ContractState) { // No initialization needed
    }

    // === IMessageLib Implementation ===
    #[abi(embed_v0)]
    impl MessageLibImpl of IMessageLib<ContractState> {
        fn send(
            ref self: ContractState, packet: Packet, options: ByteArray, pay_in_lz_token: bool,
        ) -> MessageLibSendResult {
            panic_with_byte_array(@err_not_implemented());
        }

        fn verify(
            ref self: ContractState,
            packet_header: ByteArray,
            payload_hash: Bytes32,
            confirmations: u64,
        ) {
            panic_with_byte_array(@err_not_implemented());
        }

        fn commit(ref self: ContractState, packet_header: ByteArray, payload_hash: Bytes32) {
            panic_with_byte_array(@err_not_implemented());
        }

        fn quote(
            self: @ContractState, packet: Packet, options: ByteArray, pay_in_lz_token: bool,
        ) -> MessagingFee {
            panic_with_byte_array(@err_not_implemented());
        }

        fn message_lib_type(self: @ContractState) -> MessageLibType {
            MessageLibType::SendAndReceive
        }

        fn is_supported_send_eid(self: @ContractState, dst_eid: u32) -> bool {
            true
        }

        fn is_supported_receive_eid(self: @ContractState, src_eid: u32) -> bool {
            true
        }

        fn version(self: @ContractState) -> MessageLibVersion {
            MessageLibVersion {
                major: Bounded::<u64>::MAX, minor: Bounded::<u8>::MAX, endpoint_version: 2,
            }
        }

        fn set_send_configs(
            ref self: ContractState, oapp: ContractAddress, params: Array<SetConfigParam>,
        ) {
            panic_with_byte_array(@err_not_implemented());
        }

        fn set_receive_configs(
            ref self: ContractState, oapp: ContractAddress, params: Array<SetConfigParam>,
        ) {
            panic_with_byte_array(@err_not_implemented());
        }

        fn get_send_config(
            self: @ContractState, eid: u32, oapp: ContractAddress, config_type: u32,
        ) -> Array<felt252> {
            panic_with_byte_array(@err_not_implemented());
        }

        fn get_receive_config(
            self: @ContractState, eid: u32, oapp: ContractAddress, config_type: u32,
        ) -> Array<felt252> {
            panic_with_byte_array(@err_not_implemented());
        }

        fn verifiable(
            self: @ContractState, packet_header: ByteArray, payload_hash: Bytes32,
        ) -> VerificationState {
            VerificationState::NotInitializable
        }
    }
}
