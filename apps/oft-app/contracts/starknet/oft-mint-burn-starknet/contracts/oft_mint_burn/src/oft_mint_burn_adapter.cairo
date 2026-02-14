/// A mint/burn OFT adapter with fees, rate limiting, and role-based access control.
///
/// This contract should be used to mint and burn tokens for ERC-20 token contracts
/// that implement the IMintableBurnable interface.
#[starknet::contract]
pub mod OFTMintBurnAdapter {
    use core::num::traits::Zero;
    use layerzero::common::constants::DEAD_ADDRESS;
    use layerzero::oapps::common::fee::fee::{FeeComponent, FeeHooksDefaultImpl};
    use layerzero::oapps::common::oapp_options_type_3::oapp_options_type_3::OAppOptionsType3Component;
    use layerzero::oapps::common::rate_limiter::rate_limiter::{
        RateLimiterComponent, RateLimiterHooksDefaultImpl,
    };
    use layerzero::oapps::common::rate_limiter::structs::{
        RateLimitConfig, RateLimitDirection, RateLimitEnabled,
    };
    use layerzero::oapps::oapp::oapp_core::OAppCoreComponent;
    use layerzero::oapps::oft::errors::err_slippage_exceeded;
    use layerzero::oapps::oft::oft_core::default_oapp_hooks::OFTCoreOAppHooksDefaultImpl;
    use layerzero::oapps::oft::oft_core::oft_core::OFTCoreComponent;
    use layerzero::oapps::oft::structs::OFTDebit;
    use lz_utils::error::assert_with_byte_array;
    use openzeppelin::access::accesscontrol::AccessControlComponent;

    // Access control roles
    pub use openzeppelin::access::accesscontrol::AccessControlComponent::DEFAULT_ADMIN_ROLE;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::introspection::src5::SRC5Component;
    use openzeppelin::security::pausable::PausableComponent;
    use openzeppelin::token::erc20::interface::{
        IERC20Dispatcher, IERC20DispatcherTrait, IERC20MetadataDispatcher,
        IERC20MetadataDispatcherTrait,
    };
    use openzeppelin::upgrades::UpgradeableComponent;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ClassHash, ContractAddress, get_contract_address};
    use crate::constants::{
        FEE_MANAGER_ROLE, PAUSE_MANAGER_ROLE, RATE_LIMITER_MANAGER_ROLE, UPGRADE_MANAGER_ROLE,
    };
    use crate::errors::{
        err_caller_not_owner_or_missing_role, err_no_fees_to_withdraw, err_transfer_failed,
    };
    use crate::interface::{
        IMintableTokenDispatcher, IMintableTokenDispatcherTrait, IOFTMintBurnAdapter,
    };


    // =============================== Components ===============================

    component!(path: AccessControlComponent, storage: access_control, event: AccessControlEvent);
    component!(path: SRC5Component, storage: src5, event: SRC5Event);
    component!(path: PausableComponent, storage: pausable, event: PausableEvent);
    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(path: OAppCoreComponent, storage: oapp_core, event: OAppCoreEvent);
    component!(path: OFTCoreComponent, storage: oft_core, event: OFTCoreEvent);
    component!(
        path: OAppOptionsType3Component, storage: oapp_options_type_3, event: OAppOptionsType3Event,
    );
    component!(path: FeeComponent, storage: fee, event: FeeEvent);
    component!(path: RateLimiterComponent, storage: rate_limiter, event: RateLimiterEvent);
    component!(path: UpgradeableComponent, storage: upgradeable, event: UpgradeableEvent);

    // =============================== Impls ===============================

    #[abi(embed_v0)]
    impl AccessControlImpl =
        AccessControlComponent::AccessControlImpl<ContractState>;
    impl AccessControlInternalImpl = AccessControlComponent::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl PausableImpl = PausableComponent::PausableImpl<ContractState>;
    impl PausableInternalImpl = PausableComponent::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl OwnableMixinImpl = OwnableComponent::OwnableMixinImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl OAppCoreImpl = OAppCoreComponent::OAppCoreImpl<ContractState>;
    impl OAppCoreInternalImpl = OAppCoreComponent::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl IOAppReceiverImpl = OAppCoreComponent::OAppReceiverImpl<ContractState>;
    #[abi(embed_v0)]
    impl ILayerZeroReceiverImpl =
        OAppCoreComponent::LayerZeroReceiverImpl<ContractState>;

    #[abi(embed_v0)]
    impl OFTCoreImpl = OFTCoreComponent::OFTCoreImpl<ContractState>;
    impl OFTCoreInternalImpl = OFTCoreComponent::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl OAppOptionsType3Impl =
        OAppOptionsType3Component::OAppOptionsType3Impl<ContractState>;
    impl OAppOptionsType3InternalImpl = OAppOptionsType3Component::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl FeeImpl = FeeComponent::FeeImpl<ContractState>;
    impl FeeInternalImpl = FeeComponent::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl RateLimiterImpl = RateLimiterComponent::RateLimiterImpl<ContractState>;

    impl UpgradeableInternalImpl = UpgradeableComponent::InternalImpl<ContractState>;

    // =============================== Storage ===============================

    #[storage]
    struct Storage {
        erc20_token: ContractAddress,
        minter_burner: ContractAddress,
        fee_balance: u256,
        #[substorage(v0)]
        access_control: AccessControlComponent::Storage,
        #[substorage(v0)]
        src5: SRC5Component::Storage,
        #[substorage(v0)]
        pausable: PausableComponent::Storage,
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        oapp_core: OAppCoreComponent::Storage,
        #[substorage(v0)]
        oft_core: OFTCoreComponent::Storage,
        #[substorage(v0)]
        oapp_options_type_3: OAppOptionsType3Component::Storage,
        #[substorage(v0)]
        fee: FeeComponent::Storage,
        #[substorage(v0)]
        rate_limiter: RateLimiterComponent::Storage,
        #[substorage(v0)]
        upgradeable: UpgradeableComponent::Storage,
    }

    // =============================== Events ===============================

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        FeeWithdrawn: FeeWithdrawn,
        #[flat]
        AccessControlEvent: AccessControlComponent::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
        #[flat]
        PausableEvent: PausableComponent::Event,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        OAppCoreEvent: OAppCoreComponent::Event,
        #[flat]
        OFTCoreEvent: OFTCoreComponent::Event,
        #[flat]
        OAppOptionsType3Event: OAppOptionsType3Component::Event,
        #[flat]
        FeeEvent: FeeComponent::Event,
        #[flat]
        RateLimiterEvent: RateLimiterComponent::Event,
        #[flat]
        UpgradeableEvent: UpgradeableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct FeeWithdrawn {
        pub to: ContractAddress,
        pub amount_ld: u256,
    }

    // =============================== Constructor ===============================

    #[constructor]
    fn constructor(
        ref self: ContractState,
        erc20_token: ContractAddress,
        minter_burner: ContractAddress,
        lz_endpoint: ContractAddress,
        owner: ContractAddress,
        native_token: ContractAddress,
        shared_decimals: u8,
    ) {
        self.erc20_token.write(erc20_token);
        self.minter_burner.write(minter_burner);

        self.ownable.initializer(owner);
        self.oapp_core.initializer(lz_endpoint, owner, native_token);

        // Get local decimals from the ERC20 token using ERC20Metadata interface
        let token = IERC20MetadataDispatcher { contract_address: erc20_token };
        let local_decimals = token.decimals();
        self.oft_core.initializer(local_decimals, shared_decimals);

        // Initialize access control roles - only grant DEFAULT_ADMIN_ROLE to owner
        // Other roles should be granted explicitly after deployment
        self.access_control._grant_role(DEFAULT_ADMIN_ROLE, owner);
    }

    #[abi(embed_v0)]
    impl OFTMintBurnAdapterImpl of IOFTMintBurnAdapter<ContractState> {
        // =============================== View ===============================

        fn get_minter_burner(self: @ContractState) -> ContractAddress {
            self.minter_burner.read()
        }

        fn fee_balance(self: @ContractState) -> u256 {
            self.fee_balance.read()
        }

        // =============================== Rate Limiter Manager ===============================

        fn set_rate_limits(
            ref self: ContractState,
            rate_limits: Array<RateLimitConfig>,
            direction: RateLimitDirection,
        ) {
            self._assert_owner_or_role(RATE_LIMITER_MANAGER_ROLE);
            self.rate_limiter._set_rate_limits(rate_limits, direction);
        }

        fn set_rate_limits_enabled(ref self: ContractState, enabled: RateLimitEnabled) {
            self._assert_owner_or_role(RATE_LIMITER_MANAGER_ROLE);
            self.rate_limiter._set_rate_limit_enabled(enabled);
        }

        fn reset_rate_limits(ref self: ContractState, eids: Array<u32>) {
            self._assert_owner_or_role(RATE_LIMITER_MANAGER_ROLE);
            self.rate_limiter._reset_rate_limits(eids);
        }

        // =============================== Fee Manager ===============================

        fn withdraw_fees(ref self: ContractState, to: ContractAddress) {
            self._assert_owner_or_role(FEE_MANAGER_ROLE);

            let fee_balance = self.fee_balance.read();
            assert_with_byte_array(fee_balance > 0, err_no_fees_to_withdraw());

            self.fee_balance.write(0);
            let token = IERC20Dispatcher { contract_address: self.erc20_token.read() };
            let result = token.transfer(to, fee_balance);
            assert_with_byte_array(result, err_transfer_failed(to, fee_balance));

            self.emit(FeeWithdrawn { to, amount_ld: fee_balance });
        }

        // =============================== Upgrade Manager ===============================

        fn upgrade(ref self: ContractState, new_class_hash: ClassHash) {
            self._assert_owner_or_role(UPGRADE_MANAGER_ROLE);
            self.upgradeable.upgrade(new_class_hash);
        }

        fn upgrade_and_call(
            ref self: ContractState,
            new_class_hash: ClassHash,
            selector: felt252,
            calldata: Span<felt252>,
        ) -> Span<felt252> {
            self._assert_owner_or_role(UPGRADE_MANAGER_ROLE);
            self.upgradeable.upgrade_and_call(new_class_hash, selector, calldata)
        }

        // =============================== Pausable  ===============================

        fn pause(ref self: ContractState) {
            self._assert_owner_or_role(PAUSE_MANAGER_ROLE);
            self.pausable.pause();
        }

        fn unpause(ref self: ContractState) {
            self._assert_owner_or_role(PAUSE_MANAGER_ROLE);
            self.pausable.unpause();
        }
    }

    // =============================== Internal Access Control ===============================

    #[generate_trait]
    pub impl InternalAccessControlImpl of InternalAccessControlTrait {
        fn _assert_owner_or_role(self: @ContractState, role: felt252) {
            let caller = starknet::get_caller_address();
            let is_owner = caller == self.ownable.owner();
            let has_role = self.access_control.has_role(role, caller);

            assert_with_byte_array(
                is_owner || has_role, err_caller_not_owner_or_missing_role(role),
            );
        }
    }

    // =============================== OFT Hooks ===============================

    impl OFTHooksImpl of OFTCoreComponent::OFTHooks<ContractState> {
        fn _debit(
            ref self: OFTCoreComponent::ComponentState<ContractState>,
            from: ContractAddress,
            amount: u256,
            min_amount: u256,
            dst_eid: u32,
        ) -> OFTDebit {
            // Check contract is not paused
            let contract = self.get_contract();
            contract.pausable.assert_not_paused();

            let oft_debit = self._debit_view(amount, min_amount, dst_eid);
            let fee = oft_debit.amount_sent_ld - oft_debit.amount_received_ld;

            let mut contract = self.get_contract_mut();
            contract.rate_limiter._outflow(dst_eid, oft_debit.amount_received_ld);

            let minter_burner = IMintableTokenDispatcher {
                contract_address: contract.minter_burner.read(),
            };

            if fee > 0 {
                contract.fee_balance.write(contract.fee_balance.read() + fee);
                minter_burner.permissioned_mint(get_contract_address(), fee);
            }

            minter_burner.permissioned_burn(from, oft_debit.amount_sent_ld);

            oft_debit
        }

        fn _debit_view(
            self: @OFTCoreComponent::ComponentState<ContractState>,
            amount_ld: u256,
            min_amount_ld: u256,
            dst_eid: u32,
        ) -> OFTDebit {
            // Calculate a fee based on the amount BEFORE the dust is deducted.
            let fee = self.get_contract().fee.get_fee(dst_eid, amount_ld);
            let amount_received_ld = self._remove_dust(amount_ld - fee);

            assert_with_byte_array(
                amount_received_ld >= min_amount_ld,
                err_slippage_exceeded(amount_received_ld, min_amount_ld),
            );

            let amount_sent_ld = amount_received_ld + fee;

            OFTDebit { amount_sent_ld, amount_received_ld }
        }

        fn _credit(
            ref self: OFTCoreComponent::ComponentState<ContractState>,
            to: ContractAddress,
            amount: u256,
            src_eid: u32,
        ) -> u256 {
            // Check contract is not paused
            let contract = self.get_contract();
            contract.pausable.assert_not_paused();

            // Handle the zero address case
            let to = if to.is_zero() {
                DEAD_ADDRESS
            } else {
                to
            };

            let mut contract = self.get_contract_mut();
            contract.rate_limiter._inflow(src_eid, amount);

            let minter_burner = IMintableTokenDispatcher {
                contract_address: contract.minter_burner.read(),
            };
            minter_burner.permissioned_mint(to, amount);

            amount
        }

        fn _token(self: @OFTCoreComponent::ComponentState<ContractState>) -> ContractAddress {
            self.get_contract().erc20_token.read()
        }

        fn _approval_required(self: @OFTCoreComponent::ComponentState<ContractState>) -> bool {
            // No approval since we mint/burn.
            false
        }
    }
}
