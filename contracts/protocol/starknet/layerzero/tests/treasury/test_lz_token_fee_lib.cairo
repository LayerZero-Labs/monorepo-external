//! LayerZero token fee library tests

use layerzero::treasury::interfaces::lz_token_fee_lib::{
    ILzTokenFeeLibDispatcher, ILzTokenFeeLibDispatcherTrait,
};
use starknet::ContractAddress;
use crate::constants::assert_eq;
use crate::fuzzable::contract_address::{FuzzableContractAddress, FuzzableContractAddresses};
use crate::fuzzable::eid::{Eid, FuzzableEid};
use crate::mocks::treasury::lz_token_fee_lib::{
    IMockLzTokenFeeLibAssertionDispatcher, IMockLzTokenFeeLibAssertionDispatcherTrait,
};
use crate::treasury::utils::deploy_mock_lz_token_fee_lib;

#[test]
#[fuzzer(runs: 10)]
fn test_mock_constructor(fee: u256) {
    deploy_mock_lz_token_fee_lib(fee);
}

#[test]
#[fuzzer(runs: 10)]
fn test_mock_get_fee(
    owner: ContractAddress,
    configured_fee: u256,
    sender: ContractAddress,
    dst_eid: Eid,
    worker_fee: u256,
    native_treasury_fee: u256,
) {
    let library = deploy_mock_lz_token_fee_lib(configured_fee);
    let dispatcher = ILzTokenFeeLibDispatcher { contract_address: library };
    let fee = dispatcher.get_fee(sender, dst_eid.eid, worker_fee, native_treasury_fee);
    assert_eq(fee, configured_fee);
}

#[test]
#[fuzzer(runs: 10)]
fn test_mock_pay_fee(
    owner: ContractAddress,
    configured_fee: u256,
    sender: ContractAddress,
    dst_eid: Eid,
    worker_fee: u256,
    native_treasury_fee: u256,
) {
    let library = deploy_mock_lz_token_fee_lib(configured_fee);
    let dispatcher = ILzTokenFeeLibDispatcher { contract_address: library };
    let assertion = IMockLzTokenFeeLibAssertionDispatcher { contract_address: library };
    assertion.assert_payment_count(0);

    let fee = dispatcher.pay_fee(sender, dst_eid.eid, worker_fee, native_treasury_fee);
    assert_eq(fee, configured_fee);
    assertion.assert_payment_count(1);

    let fee = dispatcher.pay_fee(sender, dst_eid.eid, worker_fee, native_treasury_fee);
    assert_eq(fee, configured_fee);
    assertion.assert_payment_count(2);
}
