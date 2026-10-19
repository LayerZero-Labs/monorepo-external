/// OApp - Simple LayerZero OApp using integrated OAppCore functionality
#[starknet::contract]
pub mod OApp {
    use layerzero::oapps::oapp::oapp_core::OAppCoreComponent;
    use lz_utils::bytes::Bytes32;
    // Core OApp implementation - all types are provided by the component traits
    use openzeppelin::access::ownable::OwnableComponent;
    use starknet::ContractAddress;
    use crate::Origin;

    component!(path: OAppCoreComponent, storage: oapp_core, event: OAppCoreEvent);
    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    // OAppCore Mixin - Core functionality
    #[abi(embed_v0)]
    impl OAppCoreImpl = OAppCoreComponent::OAppCoreImpl<ContractState>;
    #[abi(embed_v0)]
    impl ILayerZeroReceiverImpl =
        OAppCoreComponent::LayerZeroReceiverImpl<ContractState>;
    #[abi(embed_v0)]
    impl IOAppReceiverImpl = OAppCoreComponent::OAppReceiverImpl<ContractState>;
    impl OAppCoreInternalImpl = OAppCoreComponent::InternalImpl<ContractState>;

    // Ownable Mixin
    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        oapp_core: OAppCoreComponent::Storage,
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OAppCoreEvent: OAppCoreComponent::Event,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        endpoint: ContractAddress,
        owner: ContractAddress,
        native_token: ContractAddress,
    ) {
        self.oapp_core.initializer(endpoint, owner, native_token);
        self.ownable.initializer(owner);
    }

    // Implement OAppHooks to provide OApp-specific message handling operations
    impl OAppHooks of OAppCoreComponent::OAppHooks<ContractState> {
        fn _lz_receive(
            ref self: OAppCoreComponent::ComponentState<ContractState>,
            origin: Origin,
            guid: Bytes32,
            message: ByteArray,
            executor: ContractAddress,
            extra_data: ByteArray,
            value: u256,
        ) { // Contract should implement receive logic here
        }
    }
}
