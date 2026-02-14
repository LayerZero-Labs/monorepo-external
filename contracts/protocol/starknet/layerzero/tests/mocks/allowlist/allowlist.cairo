//! Mock allowlist contract for testing

#[starknet::contract]
pub mod MockAllowlist {
    use layerzero::oapps::common::allow_list::allow_list::AllowlistComponent;
    use layerzero::oapps::common::allow_list::interface::AllowlistMode;
    use starknet::ContractAddress;
    use crate::mocks::allowlist::interface::IMockAllowlist;

    component!(path: AllowlistComponent, storage: allowlist, event: AllowlistEvent);

    #[abi(embed_v0)]
    impl AllowlistImpl = AllowlistComponent::AllowlistImpl<ContractState>;

    impl AllowlistInternalImpl = AllowlistComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        allowlist: AllowlistComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        AllowlistEvent: AllowlistComponent::Event,
    }

    #[constructor]
    fn constructor(ref self: ContractState, mode: AllowlistMode) {
        self.allowlist.initializer(mode);
    }

    #[abi(embed_v0)]
    impl IMockAllowlistImpl of IMockAllowlist<ContractState> {
        fn set_allowlist_mode(ref self: ContractState, mode: AllowlistMode) {
            self.allowlist._set_allowlist_mode(mode);
        }

        fn set_whitelisted(ref self: ContractState, users: Array<ContractAddress>, status: bool) {
            self.allowlist._set_whitelisted(users.span(), status);
        }

        fn set_blacklisted(ref self: ContractState, users: Array<ContractAddress>, status: bool) {
            self.allowlist._set_blacklisted(users.span(), status);
        }

        fn assert_allowlisted(self: @ContractState, user: ContractAddress) {
            self.allowlist.assert_allowlisted(user);
        }
    }
}

