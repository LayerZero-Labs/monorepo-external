//! Executor contract

/// # Executor contract
///
/// This contract is responsible for executing LayerZero messages and native token drops.
/// It also provides a quote function for the worker to use when assigning a job.
#[starknet::contract]
pub mod Executor {
    use core::num::traits::Zero;
    use core::panics::panic_with_byte_array;
    use lz_utils::error::assert_with_byte_array;
    use openzeppelin::access::accesscontrol::AccessControlComponent;
    use openzeppelin::access::accesscontrol::interface::IAccessControl;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::introspection::src5::SRC5Component;
    use openzeppelin::security::ReentrancyGuardComponent;
    use openzeppelin::security::pausable::PausableComponent;
    use openzeppelin::token::erc20::interface::{
        IERC20Dispatcher, IERC20DispatcherTrait, IERC20SafeDispatcher, IERC20SafeDispatcherTrait,
    };
    use openzeppelin::upgrades::upgradeable::UpgradeableComponent;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ClassHash, ContractAddress, SyscallResultTrait};
    use crate::Origin;
    use crate::common::conversions::FeltArrayIntoByteArrayImpl;
    use crate::endpoint::interfaces::endpoint_v2::{
        IEndpointV2Dispatcher, IEndpointV2DispatcherTrait, IEndpointV2SafeDispatcher,
        IEndpointV2SafeDispatcherTrait,
    };
    use crate::endpoint::messaging_composer::interface::{
        IMessagingComposerSafeDispatcher, IMessagingComposerSafeDispatcherTrait,
    };
    use crate::workers::base::base::WorkerBaseComponent;
    use crate::workers::base::errors::err_role_renouncing_disabled;
    use crate::workers::base::structs::QuoteParams;
    use crate::workers::executor::errors::{
        err_approval_failed, err_price_feed_not_set, err_worker_fee_lib_not_set,
    };
    use crate::workers::executor::events::{DstConfigSet, NativeDropApplied};
    use crate::workers::executor::fee_lib::interface::{
        FeeParams, IExecutorFeeLibDispatcher, IExecutorFeeLibDispatcherTrait,
    };
    use crate::workers::executor::interface::IExecutor;
    use crate::workers::executor::structs::{
        ComposeParams, DstConfig, ExecuteParams, NativeDropParams, SetDstConfigParams,
    };
    use crate::workers::interface::ILayerZeroWorker;

    ////////////////
    // Components //
    ////////////////

    // Base worker component
    component!(path: WorkerBaseComponent, storage: worker_base, event: WorkerBaseEvent);

    // Access control components
    component!(path: AccessControlComponent, storage: access_control, event: AccessControlEvent);
    component!(path: SRC5Component, storage: src5, event: SRC5Event);

    // Upgradeable component
    component!(path: UpgradeableComponent, storage: upgradeable, event: UpgradeableEvent);

    /// Declares the reentrancy guard component which provides:
    /// - Reentrancy guard to prevent reentrancy attacks during transaction execution,
    ///   similar to the nonReentrant modifier in EVM implementations
    component!(
        path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent,
    );

    // Pausable component
    component!(path: PausableComponent, storage: pausable, event: PausableEvent);

    // Ownable component
    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    ////////////////
    // Embeddings //
    ////////////////

    #[abi(embed_v0)]
    impl WorkerBaseImpl = WorkerBaseComponent::WorkerBaseImpl<ContractState>;
    impl WorkerBaseInternalImpl = WorkerBaseComponent::InternalImpl<ContractState>;

    impl AccessControlInternalImpl = AccessControlComponent::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl PausableImpl = PausableComponent::PausableImpl<ContractState>;
    impl PausableInternalImpl = PausableComponent::InternalImpl<ContractState>;

    /// Upgradeable component internal implementation
    impl UpgradeableInternalImpl = UpgradeableComponent::InternalImpl<ContractState>;

    /// Implements the reentrancy guard component which provides:
    /// - Reentrancy guard to prevent reentrancy attacks during transaction execution,
    ///   similar to the nonReentrant modifier in EVM implementations
    impl ReentrancyGuardInternalImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        worker_base: WorkerBaseComponent::Storage,
        #[substorage(v0)]
        reentrancy_guard: ReentrancyGuardComponent::Storage,
        #[substorage(v0)]
        access_control: AccessControlComponent::Storage,
        #[substorage(v0)]
        src5: SRC5Component::Storage,
        #[substorage(v0)]
        pausable: PausableComponent::Storage,
        #[substorage(v0)]
        upgradeable: UpgradeableComponent::Storage,
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        /// A map of destination endpoint IDs to their configurations.
        dst_configs: Map<u32, DstConfig>,
        /// The address of the LayerZero EndpointV2 contract.
        endpoint: ContractAddress,
        /// The address of the native token contract.
        native_token_address: ContractAddress,
        /// The endpoint ID of the current chain.
        eid: u32,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        WorkerBaseEvent: WorkerBaseComponent::Event,
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
        #[flat]
        AccessControlEvent: AccessControlComponent::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
        #[flat]
        UpgradeableEvent: UpgradeableComponent::Event,
        #[flat]
        PausableEvent: PausableComponent::Event,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        /// Executor-specific events
        DstConfigSet: DstConfigSet,
        NativeDropApplied: NativeDropApplied,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        endpoint: ContractAddress,
        message_libs: Array<ContractAddress>,
        price_feed: ContractAddress,
        default_multiplier_bps: u16,
        role_admin: ContractAddress,
        admins: Array<ContractAddress>,
        native_token_address: ContractAddress,
    ) {
        self.eid.write(IEndpointV2Dispatcher { contract_address: endpoint }.get_eid());

        self.access_control.initializer();

        // Initialize base worker
        self
            .worker_base
            .initializer(message_libs, price_feed, default_multiplier_bps, role_admin, admins);

        // Initialize addresses
        self.endpoint.write(endpoint);
        self.native_token_address.write(native_token_address);
    }

    #[abi(embed_v0)]
    impl ExecutorImpl of IExecutor<ContractState> {
        // ================================== Only Default Admin ===============================

        /// Pause the contract (only default admin)
        fn pause(ref self: ContractState) {
            self.worker_base._assert_only_default_admin();
            self.pausable.pause();
        }

        /// Unpause the contract (only default admin)
        fn unpause(ref self: ContractState) {
            self.worker_base._assert_only_default_admin();
            self.pausable.unpause();
        }

        fn upgrade(ref self: ContractState, new_class_hash: ClassHash) {
            self.worker_base._assert_only_default_admin();
            self.upgradeable.upgrade(new_class_hash);
        }

        fn upgrade_and_call(
            ref self: ContractState,
            new_class_hash: ClassHash,
            selector: felt252,
            calldata: Span<felt252>,
        ) -> Span<felt252> {
            self.worker_base._assert_only_default_admin();
            self.upgradeable.upgrade_and_call(new_class_hash, selector, calldata)
        }

        // ================================== Only Admin =====================================

        fn set_dst_config(ref self: ContractState, params: Array<SetDstConfigParams>) {
            self.worker_base._assert_only_admin();

            let dst_config_set = params.span();
            for param in params.into_iter() {
                self.dst_configs.write(param.dst_eid, param.config);
            }

            self.emit(DstConfigSet { dst_config_set });
        }

        fn execute(ref self: ContractState, params: ExecuteParams) {
            self.worker_base._assert_only_admin();
            self.reentrancy_guard.start();
            self._execute(params);
            self.reentrancy_guard.end();
        }

        fn compose(ref self: ContractState, params: ComposeParams) {
            self.worker_base._assert_only_admin();
            self.reentrancy_guard.start();
            self._compose(params);
            self.reentrancy_guard.end();
        }

        fn native_drop(
            ref self: ContractState,
            origin: Origin,
            oapp: ContractAddress,
            native_drop_params: Array<NativeDropParams>,
        ) {
            self.worker_base._assert_only_admin();
            self._native_drop(origin, oapp, native_drop_params);
        }

        fn native_drop_and_execute(
            ref self: ContractState,
            native_drop_params: Array<NativeDropParams>,
            execute_params: ExecuteParams,
        ) {
            self.worker_base._assert_only_admin();
            self.reentrancy_guard.start();
            self
                ._native_drop(
                    execute_params.origin.clone(), execute_params.receiver, native_drop_params,
                );
            self._execute(execute_params);
            self.reentrancy_guard.end();
        }

        // ================================== View ==========================================

        fn get_dst_config(self: @ContractState, dst_eid: u32) -> DstConfig {
            self.dst_configs.read(dst_eid)
        }

        fn get_endpoint(self: @ContractState) -> ContractAddress {
            self.endpoint.read()
        }

        fn get_native_token_address(self: @ContractState) -> ContractAddress {
            self.native_token_address.read()
        }

        fn get_eid(self: @ContractState) -> u32 {
            self.eid.read()
        }
    }

    #[abi(embed_v0)]
    impl LayerZeroWorkerImpl of ILayerZeroWorker<ContractState> {
        // ================================== Only Message Lib =====================================

        /// This executor implementation does not require any additional steps beyond providing
        /// the quote when assigning a job
        fn assign_job(ref self: ContractState, params: QuoteParams) -> u256 {
            self.pausable.assert_not_paused();
            self.worker_base._assert_only_message_lib();
            self.worker_base._assert_sender_allowed(params.sender);
            self._quote(params)
        }

        // ================================== View =====================================

        fn quote(self: @ContractState, params: QuoteParams) -> u256 {
            self.pausable.assert_not_paused();
            self.worker_base._assert_sender_allowed(params.sender);
            self._quote(params)
        }
    }

    /// Access control implementation - same as OpenZeppelin except `renounce_role` is disabled
    #[abi(embed_v0)]
    pub impl AccessControlImpl of IAccessControl<ContractState> {
        fn has_role(self: @ContractState, role: felt252, account: ContractAddress) -> bool {
            self.access_control.has_role(role, account)
        }

        fn get_role_admin(self: @ContractState, role: felt252) -> felt252 {
            self.access_control.get_role_admin(role)
        }

        /// Overriding the grant role function to use the worker base component
        fn grant_role(ref self: ContractState, role: felt252, account: ContractAddress) {
            self.worker_base._assert_only_default_admin();
            self.worker_base._grant_role(role, account)
        }

        /// Overriding the revoke role function to use the worker base component
        fn revoke_role(ref self: ContractState, role: felt252, account: ContractAddress) {
            self.worker_base._assert_only_default_admin();
            self.worker_base._revoke_role(role, account)
        }

        fn renounce_role(ref self: ContractState, role: felt252, account: ContractAddress) {
            panic_with_byte_array(@err_role_renouncing_disabled())
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        #[feature("safe_dispatcher")]
        fn _execute(ref self: ContractState, params: ExecuteParams) {
            let ExecuteParams {
                origin, receiver, guid, message, value, extra_data, gas_limit, ..,
            } = params;

            let endpoint_address = self.endpoint.read();

            // Sender gives approval to the endpoint for the specified amount
            if value > 0 {
                let token = IERC20Dispatcher { contract_address: self.native_token_address.read() };
                let success = token.approve(endpoint_address, value);
                assert_with_byte_array(success, err_approval_failed());
            }

            let endpoint = IEndpointV2SafeDispatcher { contract_address: endpoint_address };
            if let Err(reason) = endpoint
                .lz_receive(
                    origin.clone(), receiver, guid, message.clone(), extra_data.clone(), value,
                ) {
                endpoint
                    .lz_receive_alert(
                        origin, receiver, guid, gas_limit, value, message, extra_data, reason,
                    )
                    .unwrap_syscall();
            }
        }

        #[feature("safe_dispatcher")]
        fn _native_drop(
            ref self: ContractState,
            origin: Origin,
            oapp: ContractAddress,
            native_drop_params: Array<NativeDropParams>,
        ) {
            let mut success = array![];

            for params in @native_drop_params {
                // Because the OpenZeppelin implementation of ERC-20 reverts with an error or
                // returns `true` always on the `transfer` function call, we need to use the safe
                // dispatcher and check the `Result` values.
                // https://docs.openzeppelin.com/contracts-cairo/2.0.0/erc20#erc20_compatibility
                let token = IERC20SafeDispatcher {
                    contract_address: self.native_token_address.read(),
                };

                let res = token.transfer(*params.receiver, *params.amount);
                success.append(res.is_ok() && res.unwrap_or(false));
            }

            self
                .emit(
                    NativeDropApplied {
                        origin, dst_eid: self.eid.read(), oapp, native_drop_params, success,
                    },
                );
        }

        #[feature("safe_dispatcher")]
        fn _compose(ref self: ContractState, params: ComposeParams) {
            let ComposeParams {
                sender, receiver, guid, index, message, gas_limit, extra_data, value,
            } = params;

            let endpoint_address = self.endpoint.read();

            // Sender gives approval to the endpoint for the specified amount
            if value > 0 {
                let token = IERC20Dispatcher { contract_address: self.native_token_address.read() };
                let success = token.approve(endpoint_address, value);
                assert_with_byte_array(success, err_approval_failed());
            }

            let composer = IMessagingComposerSafeDispatcher { contract_address: endpoint_address };
            if let Err(reason) = composer
                .lz_compose(
                    sender, receiver, guid, index, message.clone(), extra_data.clone(), value,
                ) {
                composer
                    .lz_compose_alert(
                        sender,
                        receiver,
                        guid,
                        index,
                        gas_limit,
                        value,
                        message,
                        extra_data,
                        reason,
                    )
                    .unwrap_syscall();
            }
        }

        /// Internal quote function without permission checks
        fn _quote(self: @ContractState, params: QuoteParams) -> u256 {
            let QuoteParams { dst_eid, sender, calldata_size, options, .. } = params;

            // Assert price feed is set
            let price_feed = self.worker_base.get_price_feed();
            assert_with_byte_array(price_feed.is_non_zero(), err_price_feed_not_set());

            // Assert worker fee lib is set
            let worker_fee_lib_addr = self.worker_base.get_worker_fee_lib();
            assert_with_byte_array(worker_fee_lib_addr.is_non_zero(), err_worker_fee_lib_not_set());

            let fee_params = FeeParams {
                price_feed,
                dst_eid,
                sender,
                calldata_size,
                default_multiplier_bps: self.worker_base.get_default_multiplier_bps(),
            };

            // Call fee lib to get the quote
            let fee_lib = IExecutorFeeLibDispatcher { contract_address: worker_fee_lib_addr };
            fee_lib.get_fee(fee_params, self.dst_configs.read(dst_eid), options)
        }
    }
}
