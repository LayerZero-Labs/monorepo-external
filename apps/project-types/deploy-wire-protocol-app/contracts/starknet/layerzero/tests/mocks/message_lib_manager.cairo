#[starknet::contract]
pub mod MockMessageLibManager {
    use layerzero::endpoint::message_lib_manager::message_lib_manager::MessageLibManagerComponent;
    use lz_utils::error::{Error, assert_with_byte_array, format_error};
    use openzeppelin::access::ownable::OwnableComponent;
    use starknet::ContractAddress;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};

    // === Error Definitions ===
    #[derive(Drop)]
    pub enum MockMessageLibManagerError {
        NotAuthorized,
    }

    impl ErrorNameImpl of Error<MockMessageLibManagerError> {
        fn prefix() -> ByteArray {
            "MOCK_MESSAGE_LIB_MANAGER"
        }

        fn name(self: MockMessageLibManagerError) -> ByteArray {
            match self {
                MockMessageLibManagerError::NotAuthorized => "NOT_AUTHORIZED",
            }
        }
    }

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(
        path: MessageLibManagerComponent,
        storage: message_lib_manager,
        event: MessageLibManagerEvent,
    );

    // Ownable
    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    // MessageLibManager
    #[abi(embed_v0)]
    impl MessageLibManagerImpl =
        MessageLibManagerComponent::MessageLibManagerImpl<ContractState>;
    impl MessageLibManagerInternalImpl = MessageLibManagerComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        throw_on_authorize: bool,
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        message_lib_manager: MessageLibManagerComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        MessageLibManagerEvent: MessageLibManagerComponent::Event,
    }

    pub fn err_not_authorized() -> ByteArray {
        format_error(MockMessageLibManagerError::NotAuthorized, "")
    }

    #[constructor]
    fn constructor(
        ref self: ContractState, owner: ContractAddress, blocked_library: ContractAddress,
    ) {
        self.ownable.initializer(owner);
        self.message_lib_manager.initializer(blocked_library);
    }

    #[abi(embed_v0)]
    impl MockManagerHelpers of IMockManagerHelpers<ContractState> {
        fn set_throw_on_authorize(ref self: ContractState, throw: bool) {
            self.throw_on_authorize.write(throw);
        }
    }

    #[starknet::interface]
    pub trait IMockManagerHelpers<TContractState> {
        fn set_throw_on_authorize(ref self: TContractState, throw: bool);
    }

    impl MessageLibManagerHooks of MessageLibManagerComponent::MessageLibManagerHooks<
        ContractState,
    > {
        fn _assert_authorized(
            self: @MessageLibManagerComponent::ComponentState<ContractState>, oapp: ContractAddress,
        ) {
            assert_with_byte_array(
                !self.get_contract().throw_on_authorize.read(), err_not_authorized(),
            );
        }
    }
}
