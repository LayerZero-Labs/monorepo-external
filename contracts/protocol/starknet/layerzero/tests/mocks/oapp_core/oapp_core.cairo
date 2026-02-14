//! Mock OAppCore component for testing

/// OApp - Simple LayerZero OApp using integrated OAppCore functionality
#[starknet::contract]
pub mod MockOAppCore {
    use layerzero::common::structs::packet::Origin;
    use layerzero::oapps::oapp::oapp_core::OAppCoreComponent;
    use lz_utils::bytes::Bytes32;
    // Core OApp implementation - all types are provided by the component traits
    use openzeppelin::access::ownable::OwnableComponent;
    use starknet::ContractAddress;
    use crate::mocks::oapp_core::interface::IMockOAppCore;

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
    impl OAppSenderImpl = OAppCoreComponent::OAppSenderImpl<ContractState>;

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
        stark_token: ContractAddress,
    ) {
        self.oapp_core.initializer(endpoint, owner, stark_token);
        self.ownable.initializer(owner);
    }

    // Implement OAppHooks to provide the specific OApp operations
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

    #[abi(embed_v0)]
    impl MockOAppCoreTestImpl of IMockOAppCore<ContractState> {
        // Expose internal functions for testing
        fn test_assert_only_endpoint(self: @ContractState) {
            self.oapp_core._assert_only_endpoint();
        }

        fn test_assert_only_owner(self: @ContractState) {
            self.oapp_core._assert_only_owner();
        }

        fn test_get_peer_or_revert(self: @ContractState, eid: u32) -> Bytes32 {
            self.oapp_core._get_peer_or_revert(eid)
        }

        fn test_quote(
            self: @ContractState,
            dst_eid: u32,
            message: ByteArray,
            options: ByteArray,
            pay_in_lz_token: bool,
        ) -> layerzero::common::structs::messaging::MessagingFee {
            self.oapp_core._quote(dst_eid, message, options, pay_in_lz_token)
        }

        fn test_lz_send(
            ref self: ContractState,
            caller: ContractAddress,
            dst_eid: u32,
            message: ByteArray,
            options: ByteArray,
            fee: layerzero::common::structs::messaging::MessagingFee,
            refund_address: ContractAddress,
        ) -> layerzero::common::structs::messaging::MessageReceipt {
            self.oapp_core._lz_send(caller, dst_eid, message, options, fee, refund_address)
        }

        fn test_pay_native(
            ref self: ContractState,
            caller: ContractAddress,
            endpoint: ContractAddress,
            contract_address: ContractAddress,
            fee: u256,
        ) {
            self.oapp_core._pay_native(caller, endpoint, contract_address, fee);
        }

        fn test_pay_lz_token(
            ref self: ContractState,
            caller: ContractAddress,
            endpoint: ContractAddress,
            contract_address: ContractAddress,
            fee: u256,
        ) {
            self.oapp_core._pay_lz_token(caller, endpoint, contract_address, fee);
        }

        fn test_pay_in_token(
            ref self: ContractState,
            caller: ContractAddress,
            endpoint: ContractAddress,
            contract_address: ContractAddress,
            fee: u256,
            token_address: ContractAddress,
        ) {
            self.oapp_core._pay_in_token(caller, endpoint, contract_address, fee, token_address);
        }
    }
}
