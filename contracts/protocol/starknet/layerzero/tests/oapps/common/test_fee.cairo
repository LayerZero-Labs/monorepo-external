//! LayerZero token fee library tests

use core::num::traits::SaturatingAdd;
use layerzero::common::constants::BPS_DENOMINATOR;
use layerzero::oapps::common::fee::errors::err_invalid_bps;
use layerzero::oapps::common::fee::events::{DefaultFeeBpsSet, FeeBpsSet};
use layerzero::oapps::common::fee::fee::FeeComponent;
use layerzero::oapps::common::fee::interface::{
    IFeeDispatcher, IFeeDispatcherTrait, IFeeSafeDispatcher, IFeeSafeDispatcherTrait,
};
use layerzero::oapps::common::fee::structs::FeeConfig;
use openzeppelin::access::ownable::OwnableComponent;
use snforge_std::fuzzable::{FuzzableU16, FuzzableU32, FuzzableU8};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::{
    assert_panic_with_error, assert_panic_with_felt_error, cheat_caller_address_once,
};
use crate::constants::assert_eq;
use crate::fuzzable::contract_address::FuzzableContractAddress;

struct FeeTest {
    fee: ContractAddress,
    dispatcher: IFeeDispatcher,
    safe_dispatcher: IFeeSafeDispatcher,
}

fn deploy_mock_fee(owner: ContractAddress) -> FeeTest {
    let contract = declare("MockFee").unwrap_syscall().contract_class();
    let (contract_address, _) = contract.deploy(@array![owner.into()]).unwrap_syscall();
    FeeTest {
        fee: contract_address,
        dispatcher: IFeeDispatcher { contract_address },
        safe_dispatcher: IFeeSafeDispatcher { contract_address },
    }
}

// =============================== set_default_fee_bps ===============================

#[test]
#[fuzzer(runs: 10)]
fn test_set_default_fee_bps(owner: ContractAddress, default_fee_bps: u16) {
    // default fee bps must be less than or equal to BPS_DENOMINATOR
    let default_fee_bps = default_fee_bps % (BPS_DENOMINATOR.try_into().unwrap() + 1);

    let FeeTest { dispatcher, .. } = deploy_mock_fee(owner);

    let mut spy = spy_events();

    cheat_caller_address_once(dispatcher.contract_address, owner);
    dispatcher.set_default_fee_bps(default_fee_bps);
    let expected_event = FeeComponent::Event::DefaultFeeBpsSet(
        DefaultFeeBpsSet { fee_bps: default_fee_bps },
    );

    assert_eq(dispatcher.get_raw_default_fee_bps(), default_fee_bps);
    spy.assert_emitted(@array![(dispatcher.contract_address, expected_event)]);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn test_should_fail_set_default_fee_bps_fails_when_not_owner(
    owner: ContractAddress, non_owner: ContractAddress, fee_bps: u16,
) {
    let FeeTest { safe_dispatcher, .. } = deploy_mock_fee(owner);

    cheat_caller_address_once(safe_dispatcher.contract_address, non_owner);
    let res = safe_dispatcher.set_default_fee_bps(fee_bps);

    assert_panic_with_felt_error(res, OwnableComponent::Errors::NOT_OWNER);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn test_should_fail_set_default_fee_bps_fails_when_invalid_bps(
    owner: ContractAddress, fee_bps: u16,
) {
    let fee_bps = fee_bps.saturating_add(BPS_DENOMINATOR.try_into().unwrap() + 1);

    let FeeTest { safe_dispatcher, .. } = deploy_mock_fee(owner);

    cheat_caller_address_once(safe_dispatcher.contract_address, owner);
    let res = safe_dispatcher.set_default_fee_bps(fee_bps);

    assert_panic_with_error(res, err_invalid_bps(fee_bps));
}

// =============================== set_fee_bps ===============================

#[test]
#[fuzzer(runs: 10)]
fn test_set_fee_bps(owner: ContractAddress, dst_eid: u32, fee_bps: u16, enabled: u8) {
    // convert u8 to bool by parity
    let enabled = enabled % 2 == 0;

    // fee bps must be less than or equal to BPS_DENOMINATOR
    let fee_bps = fee_bps % (BPS_DENOMINATOR.try_into().unwrap() + 1);

    let FeeTest { dispatcher, .. } = deploy_mock_fee(owner);

    let mut spy = spy_events();

    cheat_caller_address_once(dispatcher.contract_address, owner);
    dispatcher.set_fee_bps(dst_eid, fee_bps, enabled);

    let expected_event = FeeComponent::Event::FeeBpsSet(FeeBpsSet { dst_eid, fee_bps, enabled });

    assert_eq(dispatcher.get_raw_fee_bps(dst_eid), FeeConfig { fee_bps, enabled });
    spy.assert_emitted(@array![(dispatcher.contract_address, expected_event)]);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn test_should_fail_set_fee_bps_fails_when_not_owner(
    owner: ContractAddress, non_owner: ContractAddress, dst_eid: u32, fee_bps: u16, enabled: u8,
) {
    // convert u8 to bool by parity
    let enabled = enabled % 2 == 0;

    let FeeTest { safe_dispatcher, .. } = deploy_mock_fee(owner);

    cheat_caller_address_once(safe_dispatcher.contract_address, non_owner);
    let res = safe_dispatcher.set_fee_bps(dst_eid, fee_bps, enabled);

    assert_panic_with_felt_error(res, OwnableComponent::Errors::NOT_OWNER);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn test_should_fail_set_fee_bps_fails_when_invalid_bps(
    owner: ContractAddress, dst_eid: u32, fee_bps: u16, enabled: u8,
) {
    // convert u8 to bool by parity
    let enabled = enabled % 2 == 0;

    let fee_bps = fee_bps.saturating_add(BPS_DENOMINATOR.try_into().unwrap() + 1);

    let FeeTest { safe_dispatcher, .. } = deploy_mock_fee(owner);

    cheat_caller_address_once(safe_dispatcher.contract_address, owner);
    let res = safe_dispatcher.set_fee_bps(dst_eid, fee_bps, enabled);

    assert_panic_with_error(res, err_invalid_bps(fee_bps));
}

// =============================== get_fee ===============================

#[test]
#[fuzzer(runs: 10)]
fn test_get_fee_with_default_fee_bps_and_never_set_fee_bps(
    owner: ContractAddress, default_fee_bps: u16, dst_eid: u32, amount: u256,
) {
    // divide amount by BPS_DENOMINATOR to avoid overflow
    let amount = amount / BPS_DENOMINATOR;

    // fee bps must be less than or equal to BPS_DENOMINATOR
    let default_fee_bps = default_fee_bps % (BPS_DENOMINATOR.try_into().unwrap() + 1);

    let FeeTest { dispatcher, .. } = deploy_mock_fee(owner);

    cheat_caller_address_once(dispatcher.contract_address, owner);
    dispatcher.set_default_fee_bps(default_fee_bps);

    let expected_fee = amount * default_fee_bps.into() / BPS_DENOMINATOR;

    assert_eq(dispatcher.get_fee(dst_eid, amount), expected_fee);
}

#[test]
#[fuzzer(runs: 10)]
fn test_get_fee_with_default_fee_bps_and_set_fee_bps_disabled(
    owner: ContractAddress, default_fee_bps: u16, fee_bps: u16, dst_eid: u32, amount: u256,
) {
    let amount = amount / BPS_DENOMINATOR;

    // fee bps must be less than or equal to BPS_DENOMINATOR
    let default_fee_bps = default_fee_bps % (BPS_DENOMINATOR.try_into().unwrap() + 1);
    let fee_bps = fee_bps % (BPS_DENOMINATOR.try_into().unwrap() + 1);

    // enabled is false for this test
    let enabled = false;

    let FeeTest { dispatcher, .. } = deploy_mock_fee(owner);

    start_cheat_caller_address(dispatcher.contract_address, owner);
    dispatcher.set_default_fee_bps(default_fee_bps);
    dispatcher.set_fee_bps(dst_eid, fee_bps, enabled);
    stop_cheat_caller_address(dispatcher.contract_address);

    let expected_fee = amount * default_fee_bps.into() / BPS_DENOMINATOR;

    assert_eq(dispatcher.get_fee(dst_eid, amount), expected_fee);
}

#[test]
#[fuzzer(runs: 10)]
fn test_get_fee_with_custom_fee_bps(
    owner: ContractAddress, default_fee_bps: u16, fee_bps: u16, dst_eid: u32, amount: u256,
) {
    let amount = amount / BPS_DENOMINATOR;
    // fee bps must be less than or equal to BPS_DENOMINATOR
    let default_fee_bps = default_fee_bps % (BPS_DENOMINATOR.try_into().unwrap() + 1);
    let fee_bps = fee_bps % (BPS_DENOMINATOR.try_into().unwrap() + 1);
    // enabled is true for this test
    let enabled = true;

    let FeeTest { dispatcher, .. } = deploy_mock_fee(owner);

    start_cheat_caller_address(dispatcher.contract_address, owner);
    dispatcher.set_default_fee_bps(default_fee_bps);
    dispatcher.set_fee_bps(dst_eid, fee_bps, enabled);
    stop_cheat_caller_address(dispatcher.contract_address);

    let expected_fee = amount * fee_bps.into() / BPS_DENOMINATOR;

    assert_eq(dispatcher.get_fee(dst_eid, amount), expected_fee);
}

