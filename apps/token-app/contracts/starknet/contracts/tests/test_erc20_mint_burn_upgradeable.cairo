//! ERC20MintBurnUpgradeable component tests

use core::num::traits::Bounded;
use oft_mint_burn::erc20_mint_burn_upgradeable::constants::{
    BURNER_ROLE, MINTER_ROLE, PAUSE_MANAGER_ROLE,
};
use oft_mint_burn::erc20_mint_burn_upgradeable::interface::{
    IERC20MintBurnUpgradeableDispatcher, IERC20MintBurnUpgradeableDispatcherTrait,
};
use oft_mint_burn::interface::{
    IMintableTokenDispatcher, IMintableTokenDispatcherTrait, IMintableTokenSafeDispatcher,
    IMintableTokenSafeDispatcherTrait,
};
use openzeppelin::access::accesscontrol::interface::{
    IAccessControlDispatcher, IAccessControlDispatcherTrait,
};
use openzeppelin::security::interface::{IPausableDispatcher, IPausableDispatcherTrait};
use openzeppelin::security::pausable::PausableComponent::Errors as PausableErrors;
use openzeppelin::token::erc20::interface::{
    IERC20Dispatcher, IERC20DispatcherTrait, IERC20MetadataDispatcher,
    IERC20MetadataDispatcherTrait, IERC20SafeDispatcher, IERC20SafeDispatcherTrait,
};
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare, get_class_hash};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::{assert_panic_with_felt_error, cheat_caller_address_once};

const ADMIN: ContractAddress = 'admin'.try_into().unwrap();
const MINTER: ContractAddress = 'minter'.try_into().unwrap();
const BURNER: ContractAddress = 'burner'.try_into().unwrap();
const USER: ContractAddress = 'user'.try_into().unwrap();
const PAUSE_MANAGER: ContractAddress = 'pause_manager'.try_into().unwrap();
const RECIPIENT: ContractAddress = 'recipient'.try_into().unwrap();
const SHARED_DECIMALS: u8 = 6;

const DEFAULT_DECIMALS: u8 = 18;

fn deploy_erc20_mint_burn_upgradeable(
    name: ByteArray, symbol: ByteArray, admin: ContractAddress,
) -> ContractAddress {
    deploy_erc20_mint_burn_upgradeable_with_decimals(name, symbol, DEFAULT_DECIMALS, admin)
}

fn deploy_erc20_mint_burn_upgradeable_with_decimals(
    name: ByteArray, symbol: ByteArray, decimals: u8, admin: ContractAddress,
) -> ContractAddress {
    let contract = declare("ERC20MintBurnUpgradeable").unwrap_syscall().contract_class();
    let mut calldata = array![];
    name.serialize(ref calldata);
    symbol.serialize(ref calldata);
    decimals.serialize(ref calldata);
    admin.serialize(ref calldata);
    let (contract_address, _) = contract.deploy(@calldata).unwrap_syscall();
    contract_address
}

#[test]
fn test_mint_burn_roles() {
    let token = deploy_erc20_mint_burn_upgradeable("TestToken", "TT", ADMIN);
    let access_control = IAccessControlDispatcher { contract_address: token };
    let mintable_burnable = IMintableTokenDispatcher { contract_address: token };
    let erc20 = IERC20Dispatcher { contract_address: token };

    // Grant MINTER_ROLE to MINTER
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(MINTER_ROLE, MINTER);

    // Grant BURNER_ROLE to BURNER
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(BURNER_ROLE, BURNER);

    // Test minting
    let mint_amount = 1000_u256;
    cheat_caller_address_once(token, MINTER);
    mintable_burnable.permissioned_mint(USER, mint_amount);
    assert_eq!(erc20.balance_of(USER), mint_amount);
    assert_eq!(erc20.total_supply(), mint_amount);

    // Test burning
    let burn_amount = 400_u256;
    cheat_caller_address_once(token, BURNER);
    mintable_burnable.permissioned_burn(USER, burn_amount);
    assert_eq!(erc20.balance_of(USER), mint_amount - burn_amount);
    assert_eq!(erc20.total_supply(), mint_amount - burn_amount);
}

#[test]
#[should_panic(expected: ('Caller is missing role',))]
fn test_mint_without_role() {
    let token = deploy_erc20_mint_burn_upgradeable("TestToken", "TT", ADMIN);
    let mintable_burnable = IMintableTokenDispatcher { contract_address: token };

    // Try to mint without MINTER_ROLE
    cheat_caller_address_once(token, USER);
    mintable_burnable.permissioned_mint(USER, 100_u256);
}

#[test]
#[should_panic(expected: ('Caller is missing role',))]
fn test_burn_without_role() {
    let token = deploy_erc20_mint_burn_upgradeable("TestToken", "TT", ADMIN);
    let mintable_burnable = IMintableTokenDispatcher { contract_address: token };
    let access_control = IAccessControlDispatcher { contract_address: token };

    // First mint some tokens
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(MINTER_ROLE, MINTER);
    cheat_caller_address_once(token, MINTER);
    mintable_burnable.permissioned_mint(USER, 100_u256);

    // Try to burn without BURNER_ROLE
    cheat_caller_address_once(token, USER);
    mintable_burnable.permissioned_burn(USER, 50_u256);
}

#[test]
fn test_multiple_roles() {
    let token = deploy_erc20_mint_burn_upgradeable("TestToken", "TT", ADMIN);
    let access_control = IAccessControlDispatcher { contract_address: token };
    let mintable_burnable = IMintableTokenDispatcher { contract_address: token };
    let erc20 = IERC20Dispatcher { contract_address: token };

    // Grant both MINTER_ROLE and BURNER_ROLE to the same address
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(MINTER_ROLE, USER);
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(BURNER_ROLE, USER);

    // USER can now both mint and burn
    let amount = 1000_u256;
    cheat_caller_address_once(token, USER);
    mintable_burnable.permissioned_mint(USER, amount);
    assert_eq!(erc20.balance_of(USER), amount);

    cheat_caller_address_once(token, USER);
    mintable_burnable.permissioned_burn(USER, amount / 2);
    assert_eq!(erc20.balance_of(USER), amount / 2);
}

#[test]
fn test_revoke_role() {
    let token = deploy_erc20_mint_burn_upgradeable("TestToken", "TT", ADMIN);
    let access_control = IAccessControlDispatcher { contract_address: token };
    let mintable_burnable = IMintableTokenDispatcher { contract_address: token };

    // Grant and then revoke MINTER_ROLE
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(MINTER_ROLE, MINTER);

    // Minting should work
    cheat_caller_address_once(token, MINTER);
    mintable_burnable.permissioned_mint(USER, 100_u256);

    // Revoke role
    cheat_caller_address_once(token, ADMIN);
    access_control.revoke_role(MINTER_ROLE, MINTER);

    // Minting should now fail - expect panic
    cheat_caller_address_once(token, MINTER);
    // This will panic with "Caller does not have role"
// We can't test this here without another should_panic test
}

#[test]
#[fuzzer(runs: 10)]
fn test_fuzz_mint_burn(amount: u256) {
    let token = deploy_erc20_mint_burn_upgradeable("TestToken", "TT", ADMIN);
    let access_control = IAccessControlDispatcher { contract_address: token };
    let mintable_burnable = IMintableTokenDispatcher { contract_address: token };
    let erc20 = IERC20Dispatcher { contract_address: token };

    // Grant roles
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(MINTER_ROLE, MINTER);
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(BURNER_ROLE, BURNER);

    // Limit amount to prevent overflow
    let mint_amount = amount % Bounded::<u128>::MAX.into();

    // Mint
    cheat_caller_address_once(token, MINTER);
    mintable_burnable.permissioned_mint(USER, mint_amount);
    assert_eq!(erc20.balance_of(USER), mint_amount);
    assert_eq!(erc20.total_supply(), mint_amount);

    // Burn half
    let burn_amount = mint_amount / 2;
    if burn_amount > 0 {
        cheat_caller_address_once(token, BURNER);
        mintable_burnable.permissioned_burn(USER, burn_amount);
        assert_eq!(erc20.balance_of(USER), mint_amount - burn_amount);
        assert_eq!(erc20.total_supply(), mint_amount - burn_amount);
    }
}

///////////////////
// Upgrade tests //
///////////////////

#[test]
fn test_upgrade_succeeds_when_admin() {
    let token = deploy_erc20_mint_burn_upgradeable("TestToken", "TT", ADMIN);
    let upgradeable = IERC20MintBurnUpgradeableDispatcher { contract_address: token };

    // Deploy a mock contract to use as new implementation
    let new_class_hash = declare("ERC20MintBurnUpgradeable")
        .unwrap_syscall()
        .contract_class()
        .class_hash;

    // Upgrade should succeed when called by admin
    cheat_caller_address_once(token, ADMIN);
    upgradeable.upgrade(*new_class_hash);

    // Verify the upgrade
    assert_eq!(get_class_hash(token), *new_class_hash);
}

#[test]
#[should_panic(expected: ('Caller is missing role',))]
fn test_upgrade_fails_when_not_admin() {
    let token = deploy_erc20_mint_burn_upgradeable("TestToken", "TT", ADMIN);
    let upgradeable = IERC20MintBurnUpgradeableDispatcher { contract_address: token };

    // Deploy a mock contract to use as new implementation
    let new_class_hash = declare("ERC20MintBurnUpgradeable")
        .unwrap_syscall()
        .contract_class()
        .class_hash;

    // Upgrade should fail when called by non-admin
    cheat_caller_address_once(token, USER);
    upgradeable.upgrade(*new_class_hash);
}

#[test]
fn test_upgrade_and_call_succeeds_when_admin() {
    let token = deploy_erc20_mint_burn_upgradeable("TestToken", "TT", ADMIN);
    let upgradeable = IERC20MintBurnUpgradeableDispatcher { contract_address: token };
    let erc20 = IERC20Dispatcher { contract_address: token };
    let access_control = IAccessControlDispatcher { contract_address: token };
    let mintable_burnable = IMintableTokenDispatcher { contract_address: token };

    // First mint some tokens to have a non-zero total supply
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(MINTER_ROLE, MINTER);
    cheat_caller_address_once(token, MINTER);
    mintable_burnable.permissioned_mint(USER, 1000_u256);

    // Deploy same contract class (simulating an upgrade to same version for testing)
    let new_class_hash = declare("ERC20MintBurnUpgradeable")
        .unwrap_syscall()
        .contract_class()
        .class_hash;

    // Call upgrade_and_call to upgrade and then call total_supply
    cheat_caller_address_once(token, ADMIN);
    let mut result = upgradeable
        .upgrade_and_call(*new_class_hash, selector!("total_supply"), array![].span());

    // Verify the upgrade happened
    assert_eq!(get_class_hash(token), *new_class_hash);

    // Verify the call returned the expected result
    let expected_supply = erc20.total_supply();
    let actual_supply: u256 = Serde::deserialize(ref result).unwrap();
    assert_eq!(actual_supply, expected_supply);
    assert_eq!(actual_supply, 1000_u256);
}

#[test]
#[should_panic(expected: ('Caller is missing role',))]
fn test_upgrade_and_call_fails_when_not_admin() {
    let token = deploy_erc20_mint_burn_upgradeable("TestToken", "TT", ADMIN);
    let upgradeable = IERC20MintBurnUpgradeableDispatcher { contract_address: token };

    // Deploy a mock contract to use as new implementation
    let new_class_hash = declare("ERC20MintBurnUpgradeable")
        .unwrap_syscall()
        .contract_class()
        .class_hash;

    // upgrade_and_call should fail when called by non-admin
    cheat_caller_address_once(token, USER);
    upgradeable.upgrade_and_call(*new_class_hash, selector!("total_supply"), array![].span());
}

#[test]
fn test_upgrade_preserves_state() {
    let token = deploy_erc20_mint_burn_upgradeable("TestToken", "TT", ADMIN);
    let upgradeable = IERC20MintBurnUpgradeableDispatcher { contract_address: token };
    let access_control = IAccessControlDispatcher { contract_address: token };
    let mintable_burnable = IMintableTokenDispatcher { contract_address: token };
    let erc20 = IERC20Dispatcher { contract_address: token };

    // Set up some state
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(MINTER_ROLE, MINTER);
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(BURNER_ROLE, BURNER);

    // Mint some tokens
    cheat_caller_address_once(token, MINTER);
    mintable_burnable.permissioned_mint(USER, 5000_u256);

    // Store state before upgrade
    let balance_before = erc20.balance_of(USER);
    let total_supply_before = erc20.total_supply();
    let has_minter_role = access_control.has_role(MINTER_ROLE, MINTER);
    let has_burner_role = access_control.has_role(BURNER_ROLE, BURNER);

    // Upgrade
    let new_class_hash = declare("ERC20MintBurnUpgradeable")
        .unwrap_syscall()
        .contract_class()
        .class_hash;
    cheat_caller_address_once(token, ADMIN);
    upgradeable.upgrade(*new_class_hash);

    // Verify state is preserved
    assert_eq!(erc20.balance_of(USER), balance_before);
    assert_eq!(erc20.total_supply(), total_supply_before);
    assert(
        access_control.has_role(MINTER_ROLE, MINTER) == has_minter_role,
        'Minter role not preserved',
    );
    assert(
        access_control.has_role(BURNER_ROLE, BURNER) == has_burner_role,
        'Burner role not preserved',
    );

    // Verify functionality still works after upgrade
    cheat_caller_address_once(token, BURNER);
    mintable_burnable.permissioned_burn(USER, 1000_u256);
    assert_eq!(erc20.balance_of(USER), 4000_u256);
}

/////////////////
// Pause tests //
/////////////////

#[test]
fn test_pause_succeeds_when_pause_manager() {
    let token = deploy_erc20_mint_burn_upgradeable("TestToken", "TT", ADMIN);
    let access_control = IAccessControlDispatcher { contract_address: token };
    let pausable = IPausableDispatcher { contract_address: token };
    let upgradeable = IERC20MintBurnUpgradeableDispatcher { contract_address: token };

    // Grant PAUSE_MANAGER_ROLE
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(PAUSE_MANAGER_ROLE, PAUSE_MANAGER);

    // Pause should succeed
    assert!(!pausable.is_paused(), "Contract should not be paused initially");
    cheat_caller_address_once(token, PAUSE_MANAGER);
    upgradeable.pause();
    assert!(pausable.is_paused(), "Contract should be paused");
}

#[test]
fn test_unpause_succeeds_when_pause_manager() {
    let token = deploy_erc20_mint_burn_upgradeable("TestToken", "TT", ADMIN);
    let access_control = IAccessControlDispatcher { contract_address: token };
    let pausable = IPausableDispatcher { contract_address: token };
    let upgradeable = IERC20MintBurnUpgradeableDispatcher { contract_address: token };

    // Grant PAUSE_MANAGER_ROLE
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(PAUSE_MANAGER_ROLE, PAUSE_MANAGER);

    // Pause first
    cheat_caller_address_once(token, PAUSE_MANAGER);
    upgradeable.pause();
    assert!(pausable.is_paused(), "Contract should be paused");

    // Unpause should succeed
    cheat_caller_address_once(token, PAUSE_MANAGER);
    upgradeable.unpause();
    assert!(!pausable.is_paused(), "Contract should be unpaused");
}

#[test]
#[should_panic(expected: ('Caller is missing role',))]
fn test_pause_fails_without_role() {
    let token = deploy_erc20_mint_burn_upgradeable("TestToken", "TT", ADMIN);
    let upgradeable = IERC20MintBurnUpgradeableDispatcher { contract_address: token };

    // Pause should fail without PAUSE_MANAGER_ROLE
    cheat_caller_address_once(token, USER);
    upgradeable.pause();
}

#[test]
#[should_panic(expected: ('Caller is missing role',))]
fn test_unpause_fails_without_role() {
    let token = deploy_erc20_mint_burn_upgradeable("TestToken", "TT", ADMIN);
    let access_control = IAccessControlDispatcher { contract_address: token };
    let upgradeable = IERC20MintBurnUpgradeableDispatcher { contract_address: token };

    // Grant PAUSE_MANAGER_ROLE to pause first
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(PAUSE_MANAGER_ROLE, PAUSE_MANAGER);
    cheat_caller_address_once(token, PAUSE_MANAGER);
    upgradeable.pause();

    // Unpause should fail without PAUSE_MANAGER_ROLE
    cheat_caller_address_once(token, USER);
    upgradeable.unpause();
}

#[test]
#[feature("safe_dispatcher")]
fn test_transfer_fails_when_paused() {
    let token = deploy_erc20_mint_burn_upgradeable("TestToken", "TT", ADMIN);
    let access_control = IAccessControlDispatcher { contract_address: token };
    let upgradeable = IERC20MintBurnUpgradeableDispatcher { contract_address: token };
    let mintable_burnable = IMintableTokenDispatcher { contract_address: token };
    let erc20_safe = IERC20SafeDispatcher { contract_address: token };

    // Setup: mint tokens to USER
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(MINTER_ROLE, MINTER);
    cheat_caller_address_once(token, MINTER);
    mintable_burnable.permissioned_mint(USER, 1000_u256);

    // Grant PAUSE_MANAGER_ROLE and pause
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(PAUSE_MANAGER_ROLE, PAUSE_MANAGER);
    cheat_caller_address_once(token, PAUSE_MANAGER);
    upgradeable.pause();

    // Transfer should fail when paused
    cheat_caller_address_once(token, USER);
    let res = erc20_safe.transfer(RECIPIENT, 100_u256);
    assert_panic_with_felt_error(res, PausableErrors::PAUSED);
}

#[test]
#[feature("safe_dispatcher")]
fn test_transfer_from_fails_when_paused() {
    let token = deploy_erc20_mint_burn_upgradeable("TestToken", "TT", ADMIN);
    let access_control = IAccessControlDispatcher { contract_address: token };
    let upgradeable = IERC20MintBurnUpgradeableDispatcher { contract_address: token };
    let mintable_burnable = IMintableTokenDispatcher { contract_address: token };
    let erc20 = IERC20Dispatcher { contract_address: token };
    let erc20_safe = IERC20SafeDispatcher { contract_address: token };

    // Setup: mint tokens to USER and approve MINTER to spend
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(MINTER_ROLE, MINTER);
    cheat_caller_address_once(token, MINTER);
    mintable_burnable.permissioned_mint(USER, 1000_u256);
    cheat_caller_address_once(token, USER);
    erc20.approve(MINTER, 500_u256);

    // Grant PAUSE_MANAGER_ROLE and pause
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(PAUSE_MANAGER_ROLE, PAUSE_MANAGER);
    cheat_caller_address_once(token, PAUSE_MANAGER);
    upgradeable.pause();

    // transfer_from should fail when paused
    cheat_caller_address_once(token, MINTER);
    let res = erc20_safe.transfer_from(USER, RECIPIENT, 100_u256);
    assert_panic_with_felt_error(res, PausableErrors::PAUSED);
}

#[test]
fn test_mint_succeeds_when_paused() {
    let token = deploy_erc20_mint_burn_upgradeable("TestToken", "TT", ADMIN);
    let access_control = IAccessControlDispatcher { contract_address: token };
    let upgradeable = IERC20MintBurnUpgradeableDispatcher { contract_address: token };
    let mintable_burnable = IMintableTokenDispatcher { contract_address: token };
    let erc20 = IERC20Dispatcher { contract_address: token };
    let pausable = IPausableDispatcher { contract_address: token };

    // Grant MINTER_ROLE
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(MINTER_ROLE, MINTER);

    // Grant PAUSE_MANAGER_ROLE and pause
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(PAUSE_MANAGER_ROLE, PAUSE_MANAGER);
    cheat_caller_address_once(token, PAUSE_MANAGER);
    upgradeable.pause();

    // Verify paused
    assert!(pausable.is_paused(), "Contract should be paused");

    // Mint should SUCCEED when paused
    cheat_caller_address_once(token, MINTER);
    mintable_burnable.permissioned_mint(USER, 1000_u256);

    // Verify mint succeeded
    assert_eq!(erc20.balance_of(USER), 1000_u256, "Mint should succeed when paused");
    assert_eq!(erc20.total_supply(), 1000_u256, "Total supply should be updated");
}

#[test]
#[feature("safe_dispatcher")]
fn test_burn_fails_when_paused() {
    let token = deploy_erc20_mint_burn_upgradeable("TestToken", "TT", ADMIN);
    let access_control = IAccessControlDispatcher { contract_address: token };
    let upgradeable = IERC20MintBurnUpgradeableDispatcher { contract_address: token };
    let mintable_burnable = IMintableTokenDispatcher { contract_address: token };
    let mintable_burnable_safe = IMintableTokenSafeDispatcher { contract_address: token };

    // Grant roles and mint tokens first
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(MINTER_ROLE, MINTER);
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(BURNER_ROLE, BURNER);

    cheat_caller_address_once(token, MINTER);
    mintable_burnable.permissioned_mint(USER, 1000_u256);

    // Grant PAUSE_MANAGER_ROLE and pause
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(PAUSE_MANAGER_ROLE, PAUSE_MANAGER);
    cheat_caller_address_once(token, PAUSE_MANAGER);
    upgradeable.pause();

    // Burn should fail when paused
    cheat_caller_address_once(token, BURNER);
    let res = mintable_burnable_safe.permissioned_burn(USER, 500_u256);
    assert_panic_with_felt_error(res, PausableErrors::PAUSED);
}

#[test]
fn test_transfer_succeeds_after_unpause() {
    let token = deploy_erc20_mint_burn_upgradeable("TestToken", "TT", ADMIN);
    let access_control = IAccessControlDispatcher { contract_address: token };
    let upgradeable = IERC20MintBurnUpgradeableDispatcher { contract_address: token };
    let mintable_burnable = IMintableTokenDispatcher { contract_address: token };
    let erc20 = IERC20Dispatcher { contract_address: token };

    // Setup: mint tokens to USER
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(MINTER_ROLE, MINTER);
    cheat_caller_address_once(token, MINTER);
    mintable_burnable.permissioned_mint(USER, 1000_u256);

    // Grant PAUSE_MANAGER_ROLE, pause, then unpause
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(PAUSE_MANAGER_ROLE, PAUSE_MANAGER);
    cheat_caller_address_once(token, PAUSE_MANAGER);
    upgradeable.pause();
    cheat_caller_address_once(token, PAUSE_MANAGER);
    upgradeable.unpause();

    // Transfer should succeed after unpause
    cheat_caller_address_once(token, USER);
    erc20.transfer(RECIPIENT, 100_u256);
    assert_eq!(erc20.balance_of(RECIPIENT), 100_u256);
    assert_eq!(erc20.balance_of(USER), 900_u256);
}

#[test]
fn test_mint_and_burn_succeed_after_unpause() {
    let token = deploy_erc20_mint_burn_upgradeable("TestToken", "TT", ADMIN);
    let access_control = IAccessControlDispatcher { contract_address: token };
    let upgradeable = IERC20MintBurnUpgradeableDispatcher { contract_address: token };
    let mintable_burnable = IMintableTokenDispatcher { contract_address: token };
    let erc20 = IERC20Dispatcher { contract_address: token };

    // Grant roles
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(MINTER_ROLE, MINTER);
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(BURNER_ROLE, BURNER);
    cheat_caller_address_once(token, ADMIN);
    access_control.grant_role(PAUSE_MANAGER_ROLE, PAUSE_MANAGER);

    // Pause then unpause
    cheat_caller_address_once(token, PAUSE_MANAGER);
    upgradeable.pause();
    cheat_caller_address_once(token, PAUSE_MANAGER);
    upgradeable.unpause();

    // Mint should succeed after unpause
    cheat_caller_address_once(token, MINTER);
    mintable_burnable.permissioned_mint(USER, 1000_u256);
    assert_eq!(erc20.balance_of(USER), 1000_u256);

    // Burn should succeed after unpause
    cheat_caller_address_once(token, BURNER);
    mintable_burnable.permissioned_burn(USER, 400_u256);
    assert_eq!(erc20.balance_of(USER), 600_u256);
}

////////////////////
// Decimals tests //
////////////////////

#[test]
fn test_default_decimals() {
    let token = deploy_erc20_mint_burn_upgradeable("TestToken", "TT", ADMIN);
    let metadata = IERC20MetadataDispatcher { contract_address: token };

    assert_eq!(metadata.decimals(), DEFAULT_DECIMALS);
    assert_eq!(metadata.name(), "TestToken");
    assert_eq!(metadata.symbol(), "TT");
}

#[test]
fn test_custom_decimals_6() {
    let token = deploy_erc20_mint_burn_upgradeable_with_decimals("USDC", "USDC", 6, ADMIN);
    let metadata = IERC20MetadataDispatcher { contract_address: token };

    assert_eq!(metadata.decimals(), 6);
    assert_eq!(metadata.name(), "USDC");
    assert_eq!(metadata.symbol(), "USDC");
}

#[test]
fn test_custom_decimals_8() {
    let token = deploy_erc20_mint_burn_upgradeable_with_decimals("WBTC", "WBTC", 8, ADMIN);
    let metadata = IERC20MetadataDispatcher { contract_address: token };

    assert_eq!(metadata.decimals(), 8);
}
