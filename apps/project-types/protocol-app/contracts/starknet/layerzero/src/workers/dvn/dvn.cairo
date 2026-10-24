//! DVN contract implementation

/// DVN contract
///
/// The DVN contract is a key component of LayerZero's security and validation model, acting as an
/// on-chain representation of an off-chain verification network. Its primary responsibility is to
/// attest to the validity of cross-chain messages. When a message is sent from another chain to
/// Starknet, a DVN is tasked with verifying that message. This contract manages the on-chain part
/// of that process: quoting the price for verification, and providing the mechanism for a trusted
/// party (the DVN's agent) to submit the verified message for execution.
#[starknet::contract]
pub mod Dvn {
    use core::num::traits::Zero;
    use core::panics::panic_with_byte_array;
    use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
    use lz_utils::bytes::Bytes32;
    use lz_utils::error::assert_with_byte_array;
    use lz_utils::keccak::keccak256;
    use multisig::MultisigComponent;
    use openzeppelin::access::accesscontrol::AccessControlComponent;
    use openzeppelin::access::accesscontrol::interface::IAccessControl;
    use openzeppelin::introspection::src5::SRC5Component;
    use openzeppelin::upgrades::upgradeable::UpgradeableComponent;
    use openzeppelin::upgrades::upgradeable::UpgradeableComponent::InternalTrait as UpgradeableInternalTrait;
    use starknet::account::Call;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::syscalls::call_contract_syscall;
    use starknet::{
        ClassHash, ContractAddress, EthAddress, get_block_timestamp, get_contract_address,
    };
    use crate::common::constants::ZERO_ADDRESS;
    use crate::workers::access_control::{
        ADMIN_ROLE, ALLOW_LIST_ROLE, DENY_LIST_ROLE, MESSAGE_LIB_ROLE,
    };
    use crate::workers::base::base::WorkerBaseComponent;
    use crate::workers::base::errors::err_role_renouncing_disabled;
    use crate::workers::base::structs::QuoteParams;
    use crate::workers::dvn::events::DstConfigSet;
    use crate::workers::dvn::fee_lib::interface::{
        FeeParams, IDvnFeeLibDispatcher, IDvnFeeLibDispatcherTrait,
    };
    use crate::workers::dvn::interface::IDvn;
    use crate::workers::dvn::structs::{DstConfig, ExecuteParam, SetDstConfigParams};
    use crate::workers::dvn::{errors, events};
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

    // Multisig component
    component!(path: MultisigComponent, storage: multisig, event: MultisigEvent);

    ////////////////
    // Embeddings //
    ////////////////

    #[abi(embed_v0)]
    impl WorkerBaseImpl = WorkerBaseComponent::WorkerBaseImpl<ContractState>;
    impl WorkerBaseInternalImpl = WorkerBaseComponent::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl MultisigImpl = MultisigComponent::Multisig<ContractState>;
    impl MultisigInternalImpl = MultisigComponent::MultisigInternalImpl<ContractState>;

    // Multisig immutable configuration
    impl MultisigImmutableConfig of MultisigComponent::ImmutableConfig {
        // TODO: this value should be set testing the gas limit on testnet
        // with a value where you can re-set the threshold without hitting the gas limit
        const MAX_THRESHOLD: u32 = 11;
    }

    impl AccessControlInternalImpl = AccessControlComponent::InternalImpl<ContractState>;

    impl UpgradeableInternalImpl = UpgradeableComponent::InternalImpl<ContractState>;

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
        multisig: MultisigComponent::Storage,
        /// Eid => DstConfig
        dst_configs: Map<u32, DstConfig>,
        /// Verifier ID
        vid: u32,
        /// Record used hashes to prevent reentry and replay attack
        used_hashes: Map<Bytes32, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        WorkerBaseEvent: WorkerBaseComponent::Event,
        #[flat]
        AccessControlEvent: AccessControlComponent::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
        #[flat]
        UpgradeableEvent: UpgradeableComponent::Event,
        #[flat]
        MultisigEvent: MultisigComponent::Event,
        // DVN-specific events
        DstConfigSet: DstConfigSet,
        VerifySignaturesFailed: events::VerifySignaturesFailed,
        HashAlreadyUsed: events::HashAlreadyUsed,
        ExecuteFailed: events::ExecuteFailed,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        vid: u32,
        message_libs: Array<ContractAddress>,
        price_feed: ContractAddress,
        default_multiplier_bps: u16,
        multisig_signers: Span<EthAddress>,
        multisig_threshold: u32,
        admins: Array<ContractAddress>,
    ) {
        // Initialize access control component
        self.access_control.initializer();

        // Initialize base worker & multisig components
        self
            .worker_base
            .initializer(message_libs, price_feed, default_multiplier_bps, ZERO_ADDRESS, admins);
        self.multisig._init(multisig_signers, multisig_threshold);

        // Set ID
        self.vid.write(vid);
    }

    #[abi(embed_v0)]
    impl DvnImpl of IDvn<ContractState> {
        // ================================== Only Admin =====================================

        fn set_dst_config(ref self: ContractState, params: Array<SetDstConfigParams>) {
            self.worker_base._assert_only_admin();

            let dst_config_set = params.span();
            for param in params.into_iter() {
                self.dst_configs.write(param.dst_eid, param.config);
            }

            self.emit(DstConfigSet { dst_config_set });
        }

        fn execute(ref self: ContractState, params: Array<ExecuteParam>) {
            self.worker_base._assert_only_admin();

            for (index, param) in params.into_iter().enumerate() {
                let ExecuteParam { vid, call_data, expiration, signatures } = param.clone();

                // Skip if invalid or expired
                if vid != self.vid.read() || expiration <= get_block_timestamp().into() {
                    continue;
                }

                // Verify signatures
                let hash = self.hash_call_data(vid, call_data, expiration);
                if let Err(error) = self
                    .multisig
                    ._verify_n_signatures(hash.into(), signatures, self.multisig.get_threshold()) {
                    self.emit(events::VerifySignaturesFailed { error });
                    continue;
                }

                // Skip if hash already used, register hash if not
                if self.used_hashes.read(hash) {
                    self.emit(events::HashAlreadyUsed { execute_param: param, hash });
                    continue;
                }
                self.used_hashes.write(hash, true);

                // Record used hash and execute syscall
                let result = call_contract_syscall(
                    call_data.to, call_data.selector, call_data.calldata,
                );

                if let Err(data) = result {
                    // Un-use hash if syscall fails
                    self.used_hashes.write(hash, false);
                    self.emit(events::ExecuteFailed { index, data });
                }
            }
        }

        // ================================== Only Quorum =====================================

        fn quorum_change_admin(ref self: ContractState, param: ExecuteParam) {
            let ExecuteParam { vid, call_data, expiration, signatures } = param;

            // Panic if expired
            assert_with_byte_array(
                expiration > get_block_timestamp().into(), errors::err_instruction_expired(),
            );

            // Panic if target is not the DVN
            assert_with_byte_array(
                call_data.to == get_contract_address(), errors::err_invalid_target(call_data.to),
            );

            // NOTE: Deviation from EVM spec, we have to check the selector since call_data doesn't
            // include the selector without this check is possible to use another execute param with
            // an address argument to change admin
            assert_with_byte_array(
                call_data.selector == selector!("quorum_change_admin"),
                errors::err_invalid_selector(call_data.selector),
            );

            // Panic if invalid VID
            assert_with_byte_array(vid == self.vid.read(), errors::err_invalid_vid(vid));

            // Verify signatures
            let hash = self.hash_call_data(vid, call_data, expiration);
            self.multisig.verify_signatures(hash.into(), signatures);

            // Panic if hash already used
            assert_with_byte_array(!self.used_hashes.read(hash), errors::err_duplicated_hash(hash));

            // Record used hash
            self.used_hashes.write(hash, true);

            // Deserialize the new admin address from calldata & grant admin role or panic
            let mut calldata = call_data.calldata;
            let new_admin = Serde::deserialize(ref calldata);
            assert_with_byte_array(new_admin.is_some(), errors::err_invalid_quorum_admin());
            self.access_control._grant_role(ADMIN_ROLE, new_admin.unwrap());
        }

        // ================================== Only Self =====================================

        fn upgrade(ref self: ContractState, new_class_hash: ClassHash) {
            self.multisig._only_multisig();
            self.upgradeable.upgrade(new_class_hash);
        }

        fn upgrade_and_call(
            ref self: ContractState,
            new_class_hash: ClassHash,
            selector: felt252,
            calldata: Span<felt252>,
        ) -> Span<felt252> {
            self.multisig._only_multisig();
            self.upgradeable.upgrade_and_call(new_class_hash, selector, calldata)
        }

        // ================================== View ==========================================

        fn get_dst_config(self: @ContractState, dst_eid: u32) -> DstConfig {
            self.dst_configs.read(dst_eid)
        }

        fn get_vid(self: @ContractState) -> u32 {
            self.vid.read()
        }

        fn get_used_hash(self: @ContractState, hash: Bytes32) -> bool {
            self.used_hashes.read(hash)
        }

        fn hash_call_data(
            self: @ContractState, vid: u32, call_data: Call, expiration: u256,
        ) -> Bytes32 {
            // encode and keccak: vid, to, expiration, selector, call_data
            let mut payload: ByteArray = Default::default();

            payload.append_u32(vid);
            payload.append_address(call_data.to);
            payload.append_u256(expiration);
            payload.append_felt252(call_data.selector);

            for i in call_data.calldata {
                payload.append_felt252(*i);
            }

            keccak256(@payload)
        }
    }

    #[abi(embed_v0)]
    impl LayerZeroWorkerImpl of ILayerZeroWorker<ContractState> {
        // ================================== Only Message Lib =====================================

        fn assign_job(ref self: ContractState, params: QuoteParams) -> u256 {
            self.worker_base._assert_only_message_lib();
            self.worker_base._assert_sender_allowed(params.sender);
            self._quote(params)
        }

        // ================================== View =====================================

        fn quote(self: @ContractState, params: QuoteParams) -> u256 {
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

        /// Overriding the `grant_role` function to add allow list management and custom checks:
        /// - If the role is `ALLOW_LIST_ROLE`, `DENY_LIST_ROLE`, or `MESSAGE_LIB_ROLE`, only
        /// multisig can grant the role
        /// - If the role is `ADMIN_ROLE`, only admin can grant the role, as signers can do it
        /// through `quorum_change_admin`
        /// - If the role is invalid, panic
        fn grant_role(ref self: ContractState, role: felt252, account: ContractAddress) {
            self._assert_edit_role_permission(role, account);
            self.worker_base._grant_role(role, account)
        }

        /// Overriding the `revoke_role` function to add allow list management and custom checks:
        /// - If the role is `ALLOW_LIST_ROLE`, `DENY_LIST_ROLE`, or `MESSAGE_LIB_ROLE`, only
        /// multisig can revoke the role
        /// - If the role is `ADMIN_ROLE`, only admin can grant the role, as signers can do it
        /// through `quorum_change_admin`
        /// - If the role is invalid, panic
        fn revoke_role(ref self: ContractState, role: felt252, account: ContractAddress) {
            self._assert_edit_role_permission(role, account);
            self.worker_base._revoke_role(role, account)
        }

        fn renounce_role(ref self: ContractState, role: felt252, account: ContractAddress) {
            panic_with_byte_array(@err_role_renouncing_disabled())
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// Equivalent to EVM's `onlySelfOrAdmin` modifier
        fn _assert_edit_role_permission(
            self: @ContractState, role: felt252, sender: ContractAddress,
        ) {
            if role == ALLOW_LIST_ROLE || role == DENY_LIST_ROLE || role == MESSAGE_LIB_ROLE {
                return self.multisig._only_multisig();
            }

            if role == ADMIN_ROLE {
                return self.worker_base._assert_only_admin();
            }

            panic_with_byte_array(@errors::err_invalid_role(role));
        }

        /// Internal quote function without permission checks
        fn _quote(self: @ContractState, params: QuoteParams) -> u256 {
            // Assert price feed is set
            let price_feed = self.worker_base.get_price_feed();
            assert_with_byte_array(price_feed.is_non_zero(), errors::err_price_feed_not_set());

            // Assert worker fee lib is set
            let worker_fee_lib_addr = self.worker_base.get_worker_fee_lib();
            assert_with_byte_array(
                worker_fee_lib_addr.is_non_zero(), errors::err_worker_fee_lib_not_set(),
            );

            let QuoteParams { dst_eid, confirmations, sender, options, .. } = params;

            let fee_params = FeeParams {
                price_feed,
                dst_eid,
                confirmations,
                sender,
                quorum: self.multisig.get_threshold(),
                default_multiplier_bps: self.worker_base.get_default_multiplier_bps(),
            };

            // Call fee lib to get the quote
            let fee_lib = IDvnFeeLibDispatcher { contract_address: worker_fee_lib_addr };
            fee_lib.get_fee(fee_params, self.get_dst_config(dst_eid), options)
        }
    }
}
