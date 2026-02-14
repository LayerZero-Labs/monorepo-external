//! Mock Message Inspector component for testing

#[starknet::contract]
pub mod MockMessageInspector {
    use core::panics::panic_with_byte_array;
    use layerzero::oapps::message_inspector::interface::IMessageInspector;

    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl MockMessageInspectorImpl of IMessageInspector<ContractState> {
        fn inspect_msg(self: @ContractState, message: ByteArray, options: ByteArray) -> bool {
            panic_with_byte_array(@"Invalid message or options")
        }
    }
}
