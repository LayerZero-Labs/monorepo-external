/// ERC20MintBurnUpgradeable
///
/// Upgradeable ERC20 token with permissioned mint/burn functionality
/// This contract provides a standard ERC20 token that allows permissioned minters and burners
/// to mint and burn tokens through the IMintableToken interface.
///
/// Key features:
/// - MINTER_ROLE: Addresses with this role can mint tokens via permissioned_mint
/// - BURNER_ROLE: Addresses with this role can burn tokens via permissioned_burn
/// - ALLOWLIST_MANAGER_ROLE: Addresses with this role can manage the allowlist
/// - DEFAULT_ADMIN_ROLE: Can grant/revoke roles
/// - Upgradeable for future improvements
/// - Allowlist support with Open/Blacklist/Whitelist modes
#[starknet::contract]
pub mod ERC20MintBurnUpgradeable {
    use AccessControlComponent::DEFAULT_ADMIN_ROLE;
    use layerzero::common::constants::ZERO_ADDRESS;
    use layerzero::oapps::common::allow_list::allow_list::AllowlistComponent;
    use layerzero::oapps::common::allow_list::errors::err_not_allowed;
    use layerzero::oapps::common::allow_list::interface::AllowlistMode;
    use lz_utils::error::assert_with_byte_array;
    use openzeppelin::access::accesscontrol::AccessControlComponent;
    use openzeppelin::introspection::src5::SRC5Component;
    use openzeppelin::security::pausable::PausableComponent;
    use openzeppelin::token::erc20::ERC20Component;
    use openzeppelin::token::erc20::interface::IERC20Metadata;
    use openzeppelin::upgrades::UpgradeableComponent;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ClassHash, ContractAddress, get_caller_address};
    use crate::erc20_mint_burn_upgradeable::constants::{
        ALLOWLIST_MANAGER_ROLE, BURNER_ROLE, MINTER_ROLE, PAUSE_MANAGER_ROLE,
    };
    use crate::erc20_mint_burn_upgradeable::interface::IERC20MintBurnUpgradeable;
    use crate::interface::IMintableToken;

    // =============================== Components ===============================

    component!(path: ERC20Component, storage: erc20, event: ERC20Event);
    component!(path: UpgradeableComponent, storage: upgradeable, event: UpgradeableEvent);
    component!(path: PausableComponent, storage: pausable, event: PausableEvent);
    component!(path: AccessControlComponent, storage: access_control, event: AccessControlEvent);
    component!(path: SRC5Component, storage: src5, event: SRC5Event);
    component!(path: AllowlistComponent, storage: allowlist, event: AllowlistEvent);


    // Use individual embeds instead of Mixin to allow custom decimals override
    #[abi(embed_v0)]
    impl ERC20Impl = ERC20Component::ERC20Impl<ContractState>;
    #[abi(embed_v0)]
    impl ERC20CamelOnlyImpl = ERC20Component::ERC20CamelOnlyImpl<ContractState>;
    impl ERC20InternalImpl = ERC20Component::InternalImpl<ContractState>;

    impl UpgradeableInternalImpl = UpgradeableComponent::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl AccessControlImpl =
        AccessControlComponent::AccessControlImpl<ContractState>;
    impl AccessControlInternalImpl = AccessControlComponent::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl PausableImpl = PausableComponent::PausableImpl<ContractState>;
    impl PausableInternalImpl = PausableComponent::InternalImpl<ContractState>;

    #[abi(embed_v0)]
    impl AllowlistImpl = AllowlistComponent::AllowlistImpl<ContractState>;
    impl AllowlistInternalImpl = AllowlistComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        erc20: ERC20Component::Storage,
        #[substorage(v0)]
        upgradeable: UpgradeableComponent::Storage,
        #[substorage(v0)]
        access_control: AccessControlComponent::Storage,
        #[substorage(v0)]
        src5: SRC5Component::Storage,
        #[substorage(v0)]
        pausable: PausableComponent::Storage,
        #[substorage(v0)]
        allowlist: AllowlistComponent::Storage,
        /// Token decimals (configurable via constructor)
        decimals: u8,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        ERC20Event: ERC20Component::Event,
        #[flat]
        UpgradeableEvent: UpgradeableComponent::Event,
        #[flat]
        AccessControlEvent: AccessControlComponent::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
        #[flat]
        PausableEvent: PausableComponent::Event,
        #[flat]
        AllowlistEvent: AllowlistComponent::Event,
    }

    /// Initializes the ERC20 token with mint/burn capabilities
    ///
    /// # Arguments
    /// * `name` - Token name
    /// * `symbol` - Token symbol
    /// * `decimals` - Token decimals
    /// * `default_admin` - Address that will receive DEFAULT_ADMIN_ROLE
    ///
    /// # Notes
    /// The default admin can grant MINTER_ROLE, BURNER_ROLE, and ALLOWLIST_MANAGER_ROLE to other
    /// addresses. The allowlist is initialized in Open mode (all users allowed).
    #[constructor]
    fn constructor(
        ref self: ContractState,
        name: ByteArray,
        symbol: ByteArray,
        decimals: u8,
        default_admin: ContractAddress,
    ) {
        assert(default_admin != ZERO_ADDRESS, 'Invalid admin: zero address');

        // Initialize ERC20 with name and symbol
        self.erc20.initializer(name, symbol);

        // Store decimals in contract storage
        self.decimals.write(decimals);

        // Initialize access control
        self.access_control.initializer();

        // Initialize allowlist in Open mode (all users allowed by default)
        self.allowlist.initializer(AllowlistMode::Open);

        // Grant admin role to the specified address
        // Admin can then grant MINTER_ROLE, BURNER_ROLE, and ALLOWLIST_MANAGER_ROLE as needed
        self.access_control._grant_role(DEFAULT_ADMIN_ROLE, default_admin);
    }

    // Override ERC20Metadata to read decimals from storage
    #[abi(embed_v0)]
    impl ERC20MetadataImpl of IERC20Metadata<ContractState> {
        fn name(self: @ContractState) -> ByteArray {
            self.erc20.ERC20_name.read()
        }

        fn symbol(self: @ContractState) -> ByteArray {
            self.erc20.ERC20_symbol.read()
        }

        fn decimals(self: @ContractState) -> u8 {
            self.decimals.read()
        }
    }

    #[abi(embed_v0)]
    impl MintableTokenImpl of IMintableToken<ContractState> {
        /// Mints tokens to address using permitted minter pattern
        ///
        /// # Arguments
        /// * `account` - Address to mint tokens to
        /// * `amount` - Amount of tokens to mint
        ///
        /// # Access Control
        /// Only callable by accounts with MINTER_ROLE
        fn permissioned_mint(ref self: ContractState, account: ContractAddress, amount: u256) {
            self._assert_only_minter();
            self.erc20.mint(account, amount);
        }

        /// Burns tokens from address using permitted burner pattern
        ///
        /// # Arguments
        /// * `account` - Address to burn tokens from
        /// * `amount` - Amount of tokens to burn
        ///
        /// # Access Control
        /// Only callable by accounts with BURNER_ROLE
        ///
        /// # Notes
        /// Unlike standard burn, this doesn't require approval from token holder
        fn permissioned_burn(ref self: ContractState, account: ContractAddress, amount: u256) {
            self._assert_only_burner();
            self.erc20.burn(account, amount);
        }
    }

    #[abi(embed_v0)]
    impl ERC20MintBurnUpgradeableImpl of IERC20MintBurnUpgradeable<ContractState> {
        fn upgrade(ref self: ContractState, new_class_hash: ClassHash) {
            self._assert_only_default_admin();
            self.upgradeable.upgrade(new_class_hash);
        }

        fn upgrade_and_call(
            ref self: ContractState,
            new_class_hash: ClassHash,
            selector: felt252,
            calldata: Span<felt252>,
        ) -> Span<felt252> {
            self._assert_only_default_admin();
            self.upgradeable.upgrade_and_call(new_class_hash, selector, calldata)
        }

        fn pause(ref self: ContractState) {
            self._assert_only_pause_manager();
            self.pausable.pause();
        }

        fn unpause(ref self: ContractState) {
            self._assert_only_pause_manager();
            self.pausable.unpause();
        }

        fn set_allowlist_mode(ref self: ContractState, mode: AllowlistMode) {
            self._assert_only_allowlist_manager();
            self.allowlist._set_allowlist_mode(mode);
        }

        fn set_whitelisted(ref self: ContractState, users: Span<ContractAddress>, status: bool) {
            self._assert_only_allowlist_manager();
            self.allowlist._set_whitelisted(users, status);
        }

        fn set_blacklisted(ref self: ContractState, users: Span<ContractAddress>, status: bool) {
            self._assert_only_allowlist_manager();
            self.allowlist._set_blacklisted(users, status);
        }
    }

    // =============================== ERC20 Hooks ===============================

    // Overrides the default implementation of `ERC20Component::InternalTrait::update`
    // - Mint (from == zero): NO pause check, NO allowlist check - can always mint
    // - Burn (to == zero): Check pause AND allowlist on `from`
    // - Transfer (both non-zero): Check pause AND allowlist on `from`, `to`,
    // - Transfer from: caller if caller != from
    impl ERC20Hooks of ERC20Component::ERC20HooksTrait<ContractState> {
        fn before_update(
            ref self: ERC20Component::ComponentState<ContractState>,
            from: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) {
            // Mint: from == ZERO_ADDRESS - no checks, can always mint
            if from == ZERO_ADDRESS {
                return;
            }

            let contract = self.get_contract();

            // For burn and transfer: check pause
            contract.pausable.assert_not_paused();

            // For burn (to == ZERO_ADDRESS): check allowlist on `from` only
            if recipient == ZERO_ADDRESS {
                assert_with_byte_array(
                    contract.allowlist.is_user_allowlisted(from), err_not_allowed(),
                );
                return;
            }

            // For transfer: check allowlist on `from`, `recipient`, AND caller
            assert_with_byte_array(
                contract.allowlist.is_user_allowlisted(from)
                    && contract.allowlist.is_user_allowlisted(recipient),
                err_not_allowed(),
            );

            // handle transfer_from where caller != from
            let caller = get_caller_address();
            if caller != from {
                assert_with_byte_array(
                    contract.allowlist.is_user_allowlisted(caller), err_not_allowed(),
                );
            }
        }
    }

    /// Internal functions for role validation
    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// Validates caller has DEFAULT_ADMIN_ROLE
        fn _assert_only_default_admin(self: @ContractState) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);
        }

        /// Validates caller has MINTER_ROLE
        fn _assert_only_minter(self: @ContractState) {
            self.access_control.assert_only_role(MINTER_ROLE);
        }

        /// Validates caller has BURNER_ROLE
        fn _assert_only_burner(self: @ContractState) {
            self.access_control.assert_only_role(BURNER_ROLE);
        }

        /// Validates caller has PAUSE_MANAGER_ROLE
        fn _assert_only_pause_manager(self: @ContractState) {
            self.access_control.assert_only_role(PAUSE_MANAGER_ROLE);
        }

        /// Validates caller has ALLOWLIST_MANAGER_ROLE
        fn _assert_only_allowlist_manager(self: @ContractState) {
            self.access_control.assert_only_role(ALLOWLIST_MANAGER_ROLE);
        }
    }
}
