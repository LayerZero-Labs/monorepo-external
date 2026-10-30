//! AllowList component implementation
//!
//! Provides toggleable allowlist functionality between open, blacklist, and whitelist modes.
//!
//! - **Open mode**: All users are allowed
//! - **Blacklist mode**: Users on the blacklist are denied, all others are allowed
//! - **Whitelist mode**: Only users on the whitelist are allowed

#[starknet::component]
pub mod AllowlistComponent {
    use lz_utils::error::assert_with_byte_array;
    use starknet::ContractAddress;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use crate::oapps::common::allow_list::errors::err_not_allowlisted;
    use crate::oapps::common::allow_list::events::{
        AllowlistModeUpdated, BlacklistUpdated, WhitelistUpdated,
    };
    use crate::oapps::common::allow_list::interface::{AllowlistMode, IAllowlist};

    #[storage]
    pub struct Storage {
        /// Current allowlist mode
        pub Allowlist_mode: AllowlistMode,
        /// Mapping of user addresses to their blacklist state
        pub Allowlist_blacklisted: Map<ContractAddress, bool>,
        /// Mapping of user addresses to their whitelist state
        pub Allowlist_whitelisted: Map<ContractAddress, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        AllowlistModeUpdated: AllowlistModeUpdated,
        WhitelistUpdated: WhitelistUpdated,
        BlacklistUpdated: BlacklistUpdated,
    }

    #[embeddable_as(AllowlistImpl)]
    pub impl Allowlist<
        TContractState, +HasComponent<TContractState>,
    > of IAllowlist<ComponentState<TContractState>> {
        /// Returns the current allowlist mode
        fn allowlist_mode(self: @ComponentState<TContractState>) -> AllowlistMode {
            self.Allowlist_mode.read()
        }

        /// Checks if a user is allowlisted under the current mode
        fn is_user_allowlisted(
            self: @ComponentState<TContractState>, user: ContractAddress,
        ) -> bool {
            let mode = self.Allowlist_mode.read();
            match mode {
                AllowlistMode::Open => true,
                AllowlistMode::Blacklist => !self.Allowlist_blacklisted.entry(user).read(),
                AllowlistMode::Whitelist => self.Allowlist_whitelisted.entry(user).read(),
            }
        }

        /// Checks if a user is blacklisted
        fn blacklisted(self: @ComponentState<TContractState>, user: ContractAddress) -> bool {
            self.Allowlist_blacklisted.entry(user).read()
        }

        /// Checks if a user is whitelisted
        fn whitelisted(self: @ComponentState<TContractState>, user: ContractAddress) -> bool {
            self.Allowlist_whitelisted.entry(user).read()
        }
    }

    #[generate_trait]
    pub impl InternalImpl<
        TContractState, +HasComponent<TContractState>,
    > of InternalTrait<TContractState> {
        /// Initializes the allowlist with the given mode
        ///
        /// # Arguments
        /// * `mode` - Initial allowlist mode
        fn initializer(ref self: ComponentState<TContractState>, mode: AllowlistMode) {
            self._set_allowlist_mode(mode);
        }

        /// Asserts that the user is allowlisted under the current mode.
        /// Reverts with NotAllowlisted error if not.
        ///
        /// # Arguments
        /// * `user` - User address to check
        fn assert_allowlisted(self: @ComponentState<TContractState>, user: ContractAddress) {
            assert_with_byte_array(self.is_user_allowlisted(user), err_not_allowlisted(user));
        }

        /// Sets the allowlist mode
        ///
        /// # Arguments
        /// * `mode` - New allowlist mode
        fn _set_allowlist_mode(ref self: ComponentState<TContractState>, mode: AllowlistMode) {
            self.Allowlist_mode.write(mode);
            self.emit(AllowlistModeUpdated { mode });
        }

        /// Sets the whitelist state for multiple users
        ///
        /// # Arguments
        /// * `users` - Array of user addresses
        /// * `status` - Whether to whitelist (true) or unwhitelist (false) all users
        fn _set_whitelisted(
            ref self: ComponentState<TContractState>, users: Span<ContractAddress>, status: bool,
        ) {
            for user in users {
                self.Allowlist_whitelisted.entry(*user).write(status);
                self.emit(WhitelistUpdated { user: *user, status });
            }
        }

        /// Sets the blacklist state for multiple users
        ///
        /// # Arguments
        /// * `users` - Array of user addresses
        /// * `status` - Whether to blacklist (true) or unblacklist (false) all users
        fn _set_blacklisted(
            ref self: ComponentState<TContractState>, users: Span<ContractAddress>, status: bool,
        ) {
            for user in users {
                self.Allowlist_blacklisted.entry(*user).write(status);
                self.emit(BlacklistUpdated { user: *user, status });
            }
        }
    }
}
