//! Base worker contract wrapping the base worker component for testing

#[starknet::contract]
pub mod MockBaseWorker {
    use layerzero::workers::base::base::WorkerBaseComponent;
    use openzeppelin::access::accesscontrol::AccessControlComponent;
    use openzeppelin::introspection::src5::SRC5Component;
    use openzeppelin::security::pausable::PausableComponent;
    use openzeppelin::upgrades::upgradeable::UpgradeableComponent;
    use starknet::ContractAddress;

    ////////////////
    // Components //
    ////////////////

    component!(path: WorkerBaseComponent, storage: worker_base, event: WorkerBaseEvent);
    component!(path: AccessControlComponent, storage: access_control, event: AccessControlEvent);
    component!(path: SRC5Component, storage: src5, event: SRC5Event);
    component!(path: UpgradeableComponent, storage: upgradeable, event: UpgradeableEvent);
    component!(path: PausableComponent, storage: pausable, event: PausableEvent);

    ////////////////
    // Embeddings //
    ////////////////

    #[abi(embed_v0)]
    impl WorkerBaseImpl = WorkerBaseComponent::WorkerBaseImpl<ContractState>;
    impl WorkerBaseInternalImpl = WorkerBaseComponent::InternalImpl<ContractState>;

    impl AccessControlInternalImpl = AccessControlComponent::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl PausableImpl = PausableComponent::PausableImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        worker_base: WorkerBaseComponent::Storage,
        #[substorage(v0)]
        access_control: AccessControlComponent::Storage,
        #[substorage(v0)]
        src5: SRC5Component::Storage,
        #[substorage(v0)]
        upgradeable: UpgradeableComponent::Storage,
        #[substorage(v0)]
        pausable: PausableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        WorkerBaseEvent: WorkerBaseComponent::Event,
        #[flat]
        AccessControlEvent: AccessControlComponent::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
        #[flat]
        UpgradeableEvent: UpgradeableComponent::Event,
        #[flat]
        PausableEvent: PausableComponent::Event,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        message_libs: Array<ContractAddress>,
        price_feed: ContractAddress,
        default_multiplier_bps: u16,
        role_admin: ContractAddress,
        admins: Array<ContractAddress>,
    ) {
        self.access_control.initializer();
        self
            .worker_base
            .initializer(message_libs, price_feed, default_multiplier_bps, role_admin, admins);
    }
}
