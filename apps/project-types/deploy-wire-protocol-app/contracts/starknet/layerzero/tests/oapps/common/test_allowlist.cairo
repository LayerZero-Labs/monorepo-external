//! LayerZero allowlist component tests

use layerzero::oapps::common::allow_list::allow_list::AllowlistComponent;
use layerzero::oapps::common::allow_list::errors::err_not_allowlisted;
use layerzero::oapps::common::allow_list::events::{
    AllowlistModeUpdated, BlacklistUpdated, WhitelistUpdated,
};
use layerzero::oapps::common::allow_list::interface::{
    AllowlistMode, IAllowlistDispatcher, IAllowlistDispatcherTrait,
};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::assert_panic_with_error;
use crate::fuzzable::contract_address::FuzzableContractAddress;
use crate::mocks::allowlist::interface::{
    IMockAllowlistDispatcher, IMockAllowlistDispatcherTrait, IMockAllowlistSafeDispatcher,
    IMockAllowlistSafeDispatcherTrait,
};

#[derive(Drop)]
struct AllowlistHelper {
    address: ContractAddress,
    allowlist: IAllowlistDispatcher,
    mock_allowlist: IMockAllowlistDispatcher,
    safe_mock_allowlist: IMockAllowlistSafeDispatcher,
}

fn deploy_mock_allowlist(mode: AllowlistMode) -> AllowlistHelper {
    let contract = declare("MockAllowlist").unwrap_syscall().contract_class();
    let mut calldata = array![];
    mode.serialize(ref calldata);
    let (address, _) = contract.deploy(@calldata).unwrap_syscall();
    AllowlistHelper {
        address,
        allowlist: IAllowlistDispatcher { contract_address: address },
        mock_allowlist: IMockAllowlistDispatcher { contract_address: address },
        safe_mock_allowlist: IMockAllowlistSafeDispatcher { contract_address: address },
    }
}

// ============================================================================
// Deployment tests
// ============================================================================

#[test]
fn test_deploy_open_mode() {
    let helper = deploy_mock_allowlist(AllowlistMode::Open);
    assert!(helper.allowlist.allowlist_mode() == AllowlistMode::Open);
}

#[test]
fn test_deploy_blacklist_mode() {
    let helper = deploy_mock_allowlist(AllowlistMode::Blacklist);
    assert!(helper.allowlist.allowlist_mode() == AllowlistMode::Blacklist);
}

#[test]
fn test_deploy_whitelist_mode() {
    let helper = deploy_mock_allowlist(AllowlistMode::Whitelist);
    assert!(helper.allowlist.allowlist_mode() == AllowlistMode::Whitelist);
}

// ============================================================================
// Mode change tests
// ============================================================================

#[test]
fn test_set_allowlist_mode_emits_event() {
    let helper = deploy_mock_allowlist(AllowlistMode::Open);
    let mut spy = spy_events();

    helper.mock_allowlist.set_allowlist_mode(AllowlistMode::Blacklist);

    spy
        .assert_emitted(
            @array![
                (
                    helper.address,
                    AllowlistComponent::Event::AllowlistModeUpdated(
                        AllowlistModeUpdated { mode: AllowlistMode::Blacklist },
                    ),
                ),
            ],
        );

    assert!(helper.allowlist.allowlist_mode() == AllowlistMode::Blacklist);
}

#[test]
fn test_change_mode_from_open_to_whitelist() {
    let helper = deploy_mock_allowlist(AllowlistMode::Open);

    helper.mock_allowlist.set_allowlist_mode(AllowlistMode::Whitelist);

    assert!(helper.allowlist.allowlist_mode() == AllowlistMode::Whitelist);
}

#[test]
fn test_change_mode_from_blacklist_to_whitelist() {
    let helper = deploy_mock_allowlist(AllowlistMode::Blacklist);

    helper.mock_allowlist.set_allowlist_mode(AllowlistMode::Whitelist);

    assert!(helper.allowlist.allowlist_mode() == AllowlistMode::Whitelist);
}

// ============================================================================
// Open mode tests
// ============================================================================

#[test]
#[fuzzer(runs: 10)]
fn test_open_mode_allows_everyone(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Open);

    assert!(helper.allowlist.is_user_allowlisted(user));
}

#[test]
#[fuzzer(runs: 10)]
fn test_open_mode_allows_even_blacklisted_users(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Open);

    // Blacklist the user
    helper.mock_allowlist.set_blacklisted(array![user], true);

    // In Open mode, blacklist is ignored
    assert!(helper.allowlist.is_user_allowlisted(user));
}

#[test]
#[fuzzer(runs: 10)]
fn test_open_mode_assert_allowlisted_passes(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Open);

    // Should not panic in Open mode
    helper.mock_allowlist.assert_allowlisted(user);
}

// ============================================================================
// Blacklist mode tests
// ============================================================================

#[test]
#[fuzzer(runs: 10)]
fn test_blacklist_mode_allows_non_blacklisted_users(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Blacklist);

    // User is not blacklisted by default
    assert!(helper.allowlist.is_user_allowlisted(user));
}

#[test]
#[fuzzer(runs: 10)]
fn test_blacklist_mode_denies_blacklisted_users(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Blacklist);

    // Blacklist the user
    helper.mock_allowlist.set_blacklisted(array![user], true);

    // User should not be allowlisted
    assert!(!helper.allowlist.is_user_allowlisted(user));
}

#[test]
#[fuzzer(runs: 10)]
fn test_blacklist_mode_allows_unblacklisted_users(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Blacklist);

    // Blacklist then unblacklist the user
    helper.mock_allowlist.set_blacklisted(array![user], true);
    helper.mock_allowlist.set_blacklisted(array![user], false);

    // User should be allowlisted again
    assert!(helper.allowlist.is_user_allowlisted(user));
}

#[test]
#[fuzzer(runs: 10)]
fn test_blacklist_mode_assert_allowlisted_reverts_for_blacklisted(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Blacklist);

    // Blacklist the user
    helper.mock_allowlist.set_blacklisted(array![user], true);

    let result = helper.safe_mock_allowlist.assert_allowlisted(user);
    assert_panic_with_error(result, err_not_allowlisted(user));
}

#[test]
#[fuzzer(runs: 10)]
fn test_blacklist_mode_whitelist_is_ignored(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Blacklist);

    // Whitelist the user (should be ignored in blacklist mode)
    helper.mock_allowlist.set_whitelisted(array![user], true);

    // User is allowlisted because not on blacklist, not because of whitelist
    assert!(helper.allowlist.is_user_allowlisted(user));

    // Blacklist still takes effect
    helper.mock_allowlist.set_blacklisted(array![user], true);
    assert!(!helper.allowlist.is_user_allowlisted(user));
}

// ============================================================================
// Whitelist mode tests
// ============================================================================

#[test]
#[fuzzer(runs: 10)]
fn test_whitelist_mode_denies_non_whitelisted_users(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Whitelist);

    // User is not whitelisted by default
    assert!(!helper.allowlist.is_user_allowlisted(user));
}

#[test]
#[fuzzer(runs: 10)]
fn test_whitelist_mode_allows_whitelisted_users(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Whitelist);

    // Whitelist the user
    helper.mock_allowlist.set_whitelisted(array![user], true);

    // User should be allowlisted
    assert!(helper.allowlist.is_user_allowlisted(user));
}

#[test]
#[fuzzer(runs: 10)]
fn test_whitelist_mode_denies_unwhitelisted_users(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Whitelist);

    // Whitelist then unwhitelist the user
    helper.mock_allowlist.set_whitelisted(array![user], true);
    helper.mock_allowlist.set_whitelisted(array![user], false);

    // User should not be allowlisted
    assert!(!helper.allowlist.is_user_allowlisted(user));
}

#[test]
#[fuzzer(runs: 10)]
fn test_whitelist_mode_assert_allowlisted_reverts_for_non_whitelisted(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Whitelist);

    let result = helper.safe_mock_allowlist.assert_allowlisted(user);
    assert_panic_with_error(result, err_not_allowlisted(user));
}

#[test]
#[fuzzer(runs: 10)]
fn test_whitelist_mode_blacklist_is_ignored(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Whitelist);

    // Whitelist the user
    helper.mock_allowlist.set_whitelisted(array![user], true);

    // Blacklist should be ignored in whitelist mode
    helper.mock_allowlist.set_blacklisted(array![user], true);

    // User is still allowlisted because on whitelist
    assert!(helper.allowlist.is_user_allowlisted(user));
}

// ============================================================================
// Set whitelist tests
// ============================================================================

#[test]
#[fuzzer(runs: 10)]
fn test_set_whitelisted_emits_event(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Whitelist);
    let mut spy = spy_events();

    helper.mock_allowlist.set_whitelisted(array![user], true);

    spy
        .assert_emitted(
            @array![
                (
                    helper.address,
                    AllowlistComponent::Event::WhitelistUpdated(
                        WhitelistUpdated { user, status: true },
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn test_set_whitelisted_false_emits_event(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Whitelist);
    helper.mock_allowlist.set_whitelisted(array![user], true);

    let mut spy = spy_events();

    helper.mock_allowlist.set_whitelisted(array![user], false);

    spy
        .assert_emitted(
            @array![
                (
                    helper.address,
                    AllowlistComponent::Event::WhitelistUpdated(
                        WhitelistUpdated { user, status: false },
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn test_set_whitelisted_multiple_users(
    user1: ContractAddress, user2: ContractAddress, user3: ContractAddress,
) {
    let helper = deploy_mock_allowlist(AllowlistMode::Whitelist);

    helper.mock_allowlist.set_whitelisted(array![user1, user2, user3], true);

    assert!(helper.allowlist.whitelisted(user1));
    assert!(helper.allowlist.whitelisted(user2));
    assert!(helper.allowlist.whitelisted(user3));
}

#[test]
#[fuzzer(runs: 10)]
fn test_set_whitelisted_multiple_users_emits_events(
    user1: ContractAddress, user2: ContractAddress,
) {
    let helper = deploy_mock_allowlist(AllowlistMode::Whitelist);
    let mut spy = spy_events();

    helper.mock_allowlist.set_whitelisted(array![user1, user2], true);

    spy
        .assert_emitted(
            @array![
                (
                    helper.address,
                    AllowlistComponent::Event::WhitelistUpdated(
                        WhitelistUpdated { user: user1, status: true },
                    ),
                ),
                (
                    helper.address,
                    AllowlistComponent::Event::WhitelistUpdated(
                        WhitelistUpdated { user: user2, status: true },
                    ),
                ),
            ],
        );
}

// ============================================================================
// Set blacklist tests
// ============================================================================

#[test]
#[fuzzer(runs: 10)]
fn test_set_blacklisted_emits_event(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Blacklist);
    let mut spy = spy_events();

    helper.mock_allowlist.set_blacklisted(array![user], true);

    spy
        .assert_emitted(
            @array![
                (
                    helper.address,
                    AllowlistComponent::Event::BlacklistUpdated(
                        BlacklistUpdated { user, status: true },
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn test_set_blacklisted_false_emits_event(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Blacklist);
    helper.mock_allowlist.set_blacklisted(array![user], true);

    let mut spy = spy_events();

    helper.mock_allowlist.set_blacklisted(array![user], false);

    spy
        .assert_emitted(
            @array![
                (
                    helper.address,
                    AllowlistComponent::Event::BlacklistUpdated(
                        BlacklistUpdated { user, status: false },
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn test_set_blacklisted_multiple_users(
    user1: ContractAddress, user2: ContractAddress, user3: ContractAddress,
) {
    let helper = deploy_mock_allowlist(AllowlistMode::Blacklist);

    helper.mock_allowlist.set_blacklisted(array![user1, user2, user3], true);

    assert!(helper.allowlist.blacklisted(user1));
    assert!(helper.allowlist.blacklisted(user2));
    assert!(helper.allowlist.blacklisted(user3));
}

#[test]
#[fuzzer(runs: 10)]
fn test_set_blacklisted_multiple_users_emits_events(
    user1: ContractAddress, user2: ContractAddress,
) {
    let helper = deploy_mock_allowlist(AllowlistMode::Blacklist);
    let mut spy = spy_events();

    helper.mock_allowlist.set_blacklisted(array![user1, user2], true);

    spy
        .assert_emitted(
            @array![
                (
                    helper.address,
                    AllowlistComponent::Event::BlacklistUpdated(
                        BlacklistUpdated { user: user1, status: true },
                    ),
                ),
                (
                    helper.address,
                    AllowlistComponent::Event::BlacklistUpdated(
                        BlacklistUpdated { user: user2, status: true },
                    ),
                ),
            ],
        );
}

// ============================================================================
// Query functions tests
// ============================================================================

#[test]
#[fuzzer(runs: 10)]
fn test_blacklisted_returns_correct_state(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Open);

    // Not blacklisted by default
    assert!(!helper.allowlist.blacklisted(user));

    // Blacklist
    helper.mock_allowlist.set_blacklisted(array![user], true);
    assert!(helper.allowlist.blacklisted(user));

    // Unblacklist
    helper.mock_allowlist.set_blacklisted(array![user], false);
    assert!(!helper.allowlist.blacklisted(user));
}

#[test]
#[fuzzer(runs: 10)]
fn test_whitelisted_returns_correct_state(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Open);

    // Not whitelisted by default
    assert!(!helper.allowlist.whitelisted(user));

    // Whitelist
    helper.mock_allowlist.set_whitelisted(array![user], true);
    assert!(helper.allowlist.whitelisted(user));

    // Unwhitelist
    helper.mock_allowlist.set_whitelisted(array![user], false);
    assert!(!helper.allowlist.whitelisted(user));
}

// ============================================================================
// Mode switching with existing list state tests
// ============================================================================

#[test]
#[fuzzer(runs: 10)]
fn test_switch_from_blacklist_to_whitelist_preserves_lists(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Blacklist);

    // Add user to blacklist
    helper.mock_allowlist.set_blacklisted(array![user], true);
    assert!(!helper.allowlist.is_user_allowlisted(user)); // Not allowed (blacklisted)

    // Switch to whitelist mode
    helper.mock_allowlist.set_allowlist_mode(AllowlistMode::Whitelist);

    // User should not be allowlisted (not on whitelist)
    assert!(!helper.allowlist.is_user_allowlisted(user));

    // But blacklist state is preserved
    assert!(helper.allowlist.blacklisted(user));
}

#[test]
#[fuzzer(runs: 10)]
fn test_switch_from_whitelist_to_blacklist_preserves_lists(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Whitelist);

    // Add user to whitelist
    helper.mock_allowlist.set_whitelisted(array![user], true);
    assert!(helper.allowlist.is_user_allowlisted(user)); // Allowed (whitelisted)

    // Switch to blacklist mode
    helper.mock_allowlist.set_allowlist_mode(AllowlistMode::Blacklist);

    // User should be allowlisted (not on blacklist)
    assert!(helper.allowlist.is_user_allowlisted(user));

    // But whitelist state is preserved
    assert!(helper.allowlist.whitelisted(user));
}

#[test]
#[fuzzer(runs: 10)]
fn test_switch_from_open_to_whitelist(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Open);

    // User is allowed in Open mode
    assert!(helper.allowlist.is_user_allowlisted(user));

    // Switch to whitelist mode
    helper.mock_allowlist.set_allowlist_mode(AllowlistMode::Whitelist);

    // User should not be allowlisted (not on whitelist)
    assert!(!helper.allowlist.is_user_allowlisted(user));
}

#[test]
#[fuzzer(runs: 10)]
fn test_switch_from_open_to_blacklist(user: ContractAddress) {
    let helper = deploy_mock_allowlist(AllowlistMode::Open);

    // User is allowed in Open mode
    assert!(helper.allowlist.is_user_allowlisted(user));

    // Switch to blacklist mode
    helper.mock_allowlist.set_allowlist_mode(AllowlistMode::Blacklist);

    // User should still be allowlisted (not on blacklist)
    assert!(helper.allowlist.is_user_allowlisted(user));
}

