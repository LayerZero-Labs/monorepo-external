//! Mock OAppOptionsType3 component for testing

#[starknet::contract]
pub mod MockOAppOptionsType3 {
    use layerzero::oapps::common::oapp_options_type_3::oapp_options_type_3::OAppOptionsType3Component;
    use openzeppelin::access::ownable::OwnableComponent;
    use starknet::ContractAddress;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(path: OAppOptionsType3Component, storage: oapp_options, event: OAppOptionsEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl OAppOptionsType3Impl =
        OAppOptionsType3Component::OAppOptionsType3Impl<ContractState>;
    impl OAppOptionsType3InternalImpl = OAppOptionsType3Component::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        oapp_options: OAppOptionsType3Component::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        OAppOptionsEvent: OAppOptionsType3Component::Event,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.ownable.initializer(owner);
    }
}
