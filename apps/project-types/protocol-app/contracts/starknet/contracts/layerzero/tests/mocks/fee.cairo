//! Mock fee contract for testing

#[starknet::contract]
pub mod MockFee {
    use layerzero::oapps::common::fee::fee::FeeComponent;

    // We have to import this to use the default hooks implementation
    use layerzero::oapps::common::fee::fee::FeeHooksDefaultImpl;
    use openzeppelin::access::ownable::OwnableComponent;
    use starknet::ContractAddress;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(path: FeeComponent, storage: fee, event: FeeEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl FeeImpl = FeeComponent::FeeImpl<ContractState>;
    impl FeeInternalImpl = FeeComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        fee: FeeComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        FeeEvent: FeeComponent::Event,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.ownable.initializer(owner);
    }
}
