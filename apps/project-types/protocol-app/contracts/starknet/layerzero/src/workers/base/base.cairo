//! Base worker component implementation

#[starknet::component]
pub mod WorkerBaseComponent {
    use core::num::traits::Zero;
    use lz_utils::error::assert_with_byte_array;
    use openzeppelin::access::accesscontrol::AccessControlComponent;
    use openzeppelin::access::accesscontrol::AccessControlComponent::InternalImpl as AccessControlInternalImpl;
    use openzeppelin::access::accesscontrol::interface::IAccessControl;
    use openzeppelin::introspection::src5::SRC5Component;
    use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
    use starknet::ContractAddress;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use crate::workers::access_control::{
        ADMIN_ROLE, ALLOW_LIST_ROLE, DEFAULT_ADMIN_ROLE, DENY_LIST_ROLE, MESSAGE_LIB_ROLE,
    };
    use crate::workers::base::errors::{err_sender_not_allowed, err_transfer_failed};
    use crate::workers::base::events::{
        DefaultMultiplierBpsSet, FeeWithdrawn, PriceFeedSet, SupportedOptionTypeSet,
        WorkerFeeLibSet,
    };
    use crate::workers::base::interface::IWorkerBase;

    // =============================== Storage =================================

    #[storage]
    pub struct Storage {
        pub WorkerBase_price_feed: ContractAddress,
        pub WorkerBase_default_multiplier_bps: u16,
        /// EID => option type
        pub WorkerBase_supported_option_types: Map<u32, ByteArray>,
        pub WorkerBase_worker_fee_lib: ContractAddress,
        /// Allow list size to check sender permissions
        pub WorkerBase_allow_list_size: u64,
    }

    // =============================== Events =================================

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PriceFeedSet: PriceFeedSet,
        FeeWithdrawn: FeeWithdrawn,
        SupportedOptionTypeSet: SupportedOptionTypeSet,
        DefaultMultiplierBpsSet: DefaultMultiplierBpsSet,
        WorkerFeeLibSet: WorkerFeeLibSet,
    }

    #[embeddable_as(WorkerBaseImpl)]
    impl WorkerBase<
        TContractState,
        +HasComponent<TContractState>,
        impl AccessControl: AccessControlComponent::HasComponent<TContractState>,
        +SRC5Component::HasComponent<TContractState>,
        +Drop<TContractState>,
    > of IWorkerBase<ComponentState<TContractState>> {
        // ===================================== Only Admin =====================================

        fn set_price_feed(ref self: ComponentState<TContractState>, price_feed: ContractAddress) {
            self._assert_only_admin();

            let old_price_feed = self.WorkerBase_price_feed.read();
            self.WorkerBase_price_feed.write(price_feed);
            self.emit(PriceFeedSet { old_price_feed, new_price_feed: price_feed });
        }

        fn set_supported_option_type(
            ref self: ComponentState<TContractState>, eid: u32, option_type: ByteArray,
        ) {
            self._assert_only_admin();
            self.WorkerBase_supported_option_types.entry(eid).write(option_type.clone());
            self.emit(SupportedOptionTypeSet { eid, option_type });
        }

        fn set_default_multiplier_bps(
            ref self: ComponentState<TContractState>, default_multiplier_bps: u16,
        ) {
            self._assert_only_admin();
            self.WorkerBase_default_multiplier_bps.write(default_multiplier_bps);
            self.emit(DefaultMultiplierBpsSet { default_multiplier_bps });
        }

        fn withdraw_fee(
            ref self: ComponentState<TContractState>,
            token_address: ContractAddress,
            to: ContractAddress,
            amount: u256,
        ) {
            self._assert_only_admin();
            let token = IERC20Dispatcher { contract_address: token_address };
            let success = token.transfer(to, amount);
            assert_with_byte_array(success, err_transfer_failed());
            self.emit(FeeWithdrawn { to, amount });
        }

        fn set_worker_fee_lib(
            ref self: ComponentState<TContractState>, worker_fee_lib: ContractAddress,
        ) {
            self._assert_only_admin();

            let old_worker_fee_lib = self.WorkerBase_worker_fee_lib.read();
            self.WorkerBase_worker_fee_lib.write(worker_fee_lib);
            self.emit(WorkerFeeLibSet { old_worker_fee_lib, new_worker_fee_lib: worker_fee_lib });
        }

        // ======================================= View ========================================

        fn get_price_feed(self: @ComponentState<TContractState>) -> ContractAddress {
            self.WorkerBase_price_feed.read()
        }

        fn get_supported_option_type(self: @ComponentState<TContractState>, eid: u32) -> ByteArray {
            self.WorkerBase_supported_option_types.entry(eid).read()
        }

        fn get_default_multiplier_bps(self: @ComponentState<TContractState>) -> u16 {
            self.WorkerBase_default_multiplier_bps.read()
        }

        fn get_worker_fee_lib(self: @ComponentState<TContractState>) -> ContractAddress {
            self.WorkerBase_worker_fee_lib.read()
        }

        fn get_allow_list_size(self: @ComponentState<TContractState>) -> u64 {
            self.WorkerBase_allow_list_size.read()
        }

        fn is_sender_allowed(
            self: @ComponentState<TContractState>, sender: ContractAddress,
        ) -> bool {
            self._is_sender_allowed(sender)
        }
    }

    // internal
    #[generate_trait]
    pub impl InternalImpl<
        TContractState,
        +HasComponent<TContractState>,
        impl AccessControl: AccessControlComponent::HasComponent<TContractState>,
        +SRC5Component::HasComponent<TContractState>,
        +Drop<TContractState>,
    > of InternalTrait<TContractState> {
        /// Initialize the base worker component
        fn initializer(
            ref self: ComponentState<TContractState>,
            message_libs: Array<ContractAddress>,
            price_feed: ContractAddress,
            default_multiplier_bps: u16,
            role_admin: ContractAddress,
            admins: Array<ContractAddress>,
        ) {
            // Set initial values
            self.WorkerBase_default_multiplier_bps.write(default_multiplier_bps);
            self.WorkerBase_price_feed.write(price_feed);

            // Set role admin
            let mut access_control = get_dep_component_mut!(ref self, AccessControl);
            if !role_admin.is_zero() {
                access_control._grant_role(DEFAULT_ADMIN_ROLE, role_admin);
            }

            // Set message libs
            for message_lib in message_libs {
                access_control._grant_role(MESSAGE_LIB_ROLE, message_lib);
            }

            // Set additional admins
            for admin in admins {
                access_control._grant_role(ADMIN_ROLE, admin);
            }
        }

        /// Internal grant role to keep track of allow list size
        fn _grant_role(
            ref self: ComponentState<TContractState>, role: felt252, account: ContractAddress,
        ) {
            let mut access_control = get_dep_component_mut!(ref self, AccessControl);
            if role == ALLOW_LIST_ROLE && !access_control.has_role(ALLOW_LIST_ROLE, account) {
                self.WorkerBase_allow_list_size.write(self.WorkerBase_allow_list_size.read() + 1);
            }
            access_control._grant_role(role, account);
        }

        /// Internal revoke role to keep track of allow list size
        fn _revoke_role(
            ref self: ComponentState<TContractState>, role: felt252, account: ContractAddress,
        ) {
            let mut access_control = get_dep_component_mut!(ref self, AccessControl);
            if role == ALLOW_LIST_ROLE && access_control.has_role(ALLOW_LIST_ROLE, account) {
                self.WorkerBase_allow_list_size.write(self.WorkerBase_allow_list_size.read() - 1);
            }
            access_control._revoke_role(role, account);
        }

        fn _is_sender_allowed(
            self: @ComponentState<TContractState>, sender: ContractAddress,
        ) -> bool {
            let access_control = get_dep_component!(self, AccessControl);

            !access_control.has_role(DENY_LIST_ROLE, sender)
                && (self.WorkerBase_allow_list_size.read() == 0
                    || access_control.has_role(ALLOW_LIST_ROLE, sender))
        }

        /// Internal function to check if the sender is allowed to perform the action
        ///
        /// it checks if its deny listed, or if there is an allow list, and if there is, if its in
        /// the allow list
        fn _assert_sender_allowed(self: @ComponentState<TContractState>, sender: ContractAddress) {
            assert_with_byte_array(self._is_sender_allowed(sender), err_sender_not_allowed());
        }


        fn _assert_only_default_admin(self: @ComponentState<TContractState>) {
            get_dep_component!(self, AccessControl).assert_only_role(DEFAULT_ADMIN_ROLE);
        }

        fn _assert_only_admin(self: @ComponentState<TContractState>) {
            get_dep_component!(self, AccessControl).assert_only_role(ADMIN_ROLE);
        }

        fn _assert_only_message_lib(self: @ComponentState<TContractState>) {
            get_dep_component!(self, AccessControl).assert_only_role(MESSAGE_LIB_ROLE);
        }
    }
}
