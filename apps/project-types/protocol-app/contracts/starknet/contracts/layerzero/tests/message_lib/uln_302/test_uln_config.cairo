//! ULN config tests

use core::traits::TryInto;
use layerzero::message_lib::uln_302::errors::{
    err_invalid_optional_dvn_threshold, err_must_have_at_least_one_dvn, err_too_many_dvns,
};
use layerzero::message_lib::uln_302::structs::uln_config::{
    MAX_DVN_COUNT, UlnConfig, UlnConfigUtilsImpl,
};
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::assert_panic_with_error;
use crate::mocks::uln_config::interface::{
    IMockUlnConfigDispatcher, IMockUlnConfigDispatcherTrait, IMockUlnConfigSafeDispatcher,
    IMockUlnConfigSafeDispatcherTrait,
};

// Test constants
const DVN_1: ContractAddress = 1.try_into().unwrap();
const DVN_2: ContractAddress = 2.try_into().unwrap();
const DVN_3: ContractAddress = 3.try_into().unwrap();
const DVN_4: ContractAddress = 4.try_into().unwrap();
const DVN_5: ContractAddress = 5.try_into().unwrap();

// Helper function to deploy the mock contract
fn deploy_mock_uln_config() -> (IMockUlnConfigDispatcher, IMockUlnConfigSafeDispatcher) {
    let contract = declare("MockUlnConfig").unwrap_syscall().contract_class();
    let (contract_address, _) = contract.deploy(@array![]).unwrap_syscall();
    let dispatcher = IMockUlnConfigDispatcher { contract_address };
    let safe_dispatcher = IMockUlnConfigSafeDispatcher { contract_address };
    (dispatcher, safe_dispatcher)
}

#[test]
fn test_resolve_with_custom_confirmations() {
    let (mock, _) = deploy_mock_uln_config();

    let default_config = UlnConfig {
        confirmations: 10,
        has_confirmations: false,
        required_dvns: array![DVN_1],
        has_required_dvns: false,
        optional_dvns: array![DVN_2],
        optional_dvn_threshold: 1,
        has_optional_dvns: false,
    };

    let custom_config = UlnConfig {
        confirmations: 20,
        has_confirmations: true,
        required_dvns: array![DVN_3],
        has_required_dvns: false,
        optional_dvns: array![DVN_4],
        optional_dvn_threshold: 2,
        has_optional_dvns: false,
    };

    let resolved = mock.resolve(default_config, custom_config);

    // Only confirmations should be overridden since has_confirmations is true
    assert(resolved.confirmations == 20, 'confirmations not overridden');
    assert(resolved.required_dvns == array![DVN_1], 'required_dvns should be default');
    assert(resolved.optional_dvns == array![DVN_2], 'optional_dvns should be default');
    assert(resolved.optional_dvn_threshold == 1, 'threshold should be default');
}

#[test]
fn test_resolve_with_custom_required_dvns() {
    let (mock, _) = deploy_mock_uln_config();

    let default_config = UlnConfig {
        confirmations: 10,
        has_confirmations: false,
        required_dvns: array![DVN_1],
        has_required_dvns: false,
        optional_dvns: array![DVN_2],
        optional_dvn_threshold: 1,
        has_optional_dvns: false,
    };

    let custom_config = UlnConfig {
        confirmations: 20,
        has_confirmations: false,
        required_dvns: array![DVN_3],
        has_required_dvns: true,
        optional_dvns: array![DVN_4],
        optional_dvn_threshold: 2,
        has_optional_dvns: false,
    };

    let resolved = mock.resolve(default_config, custom_config);

    // Only required_dvns should be overridden since has_required_dvns is true
    assert(resolved.confirmations == 10, 'confirmations should be default');
    assert(resolved.required_dvns == array![DVN_3], 'required_dvns not overridden');
    assert(resolved.optional_dvns == array![DVN_2], 'optional_dvns should be default');
    assert(resolved.optional_dvn_threshold == 1, 'threshold should be default');
}

#[test]
fn test_resolve_with_custom_optional_dvns() {
    let (mock, _) = deploy_mock_uln_config();

    let default_config = UlnConfig {
        confirmations: 10,
        has_confirmations: false,
        required_dvns: array![DVN_1],
        has_required_dvns: false,
        optional_dvns: array![DVN_2],
        optional_dvn_threshold: 1,
        has_optional_dvns: false,
    };

    let custom_config = UlnConfig {
        confirmations: 20,
        has_confirmations: false,
        required_dvns: array![DVN_3],
        has_required_dvns: false,
        optional_dvns: array![DVN_4, DVN_5],
        optional_dvn_threshold: 2,
        has_optional_dvns: true,
    };

    let resolved = mock.resolve(default_config, custom_config);

    // Only optional_dvns should be overridden since has_optional_dvns is true
    assert(resolved.confirmations == 10, 'confirmations should be default');
    assert(resolved.required_dvns == array![DVN_1], 'required_dvns should be default');
    assert(resolved.optional_dvns == array![DVN_4, DVN_5], 'optional_dvns not overridden');
    assert(resolved.optional_dvn_threshold == 2, 'threshold not overridden');
}

#[test]
fn test_resolve_with_all_custom_flags() {
    let (mock, _) = deploy_mock_uln_config();

    let default_config = UlnConfig {
        confirmations: 10,
        has_confirmations: false,
        required_dvns: array![DVN_1],
        has_required_dvns: false,
        optional_dvns: array![DVN_2],
        optional_dvn_threshold: 1,
        has_optional_dvns: false,
    };

    let custom_config = UlnConfig {
        confirmations: 20,
        has_confirmations: true,
        required_dvns: array![DVN_3],
        has_required_dvns: true,
        optional_dvns: array![DVN_4, DVN_5],
        optional_dvn_threshold: 2,
        has_optional_dvns: true,
    };

    let resolved = mock.resolve(default_config, custom_config);

    // All custom values should override default values
    assert(resolved.confirmations == 20, 'confirmations not overridden');
    assert(resolved.required_dvns == array![DVN_3], 'required_dvns not overridden');
    assert(resolved.optional_dvns == array![DVN_4, DVN_5], 'optional_dvns not overridden');
    assert(resolved.optional_dvn_threshold == 2, 'threshold not overridden');
}

#[test]
fn test_resolve_with_no_custom_flags() {
    let (mock, _) = deploy_mock_uln_config();

    let default_config = UlnConfig {
        confirmations: 10,
        has_confirmations: false,
        required_dvns: array![DVN_1],
        has_required_dvns: false,
        optional_dvns: array![DVN_2],
        optional_dvn_threshold: 1,
        has_optional_dvns: false,
    };

    let custom_config = UlnConfig {
        confirmations: 999, // Should be ignored
        has_confirmations: false,
        required_dvns: array![DVN_3], // Should be ignored
        has_required_dvns: false,
        optional_dvns: array![DVN_4], // Should be ignored
        optional_dvn_threshold: 9, // Should be ignored
        has_optional_dvns: false,
    };

    let resolved = mock.resolve(default_config, custom_config);

    // All default values should be kept
    assert(resolved.confirmations == 10, 'confirmations should be default');
    assert(resolved.required_dvns == array![DVN_1], 'required_dvns should be default');
    assert(resolved.optional_dvns == array![DVN_2], 'optional_dvns should be default');
    assert(resolved.optional_dvn_threshold == 1, 'threshold should be default');
}

#[test]
fn test_resolve_with_valid_config() {
    let (mock, _) = deploy_mock_uln_config();

    let default_config = UlnConfig {
        confirmations: 10,
        has_confirmations: false,
        required_dvns: array![DVN_1],
        has_required_dvns: false,
        optional_dvns: array![DVN_2],
        optional_dvn_threshold: 1,
        has_optional_dvns: false,
    };

    let custom_config = UlnConfig {
        confirmations: 20,
        has_confirmations: true,
        required_dvns: array![DVN_3],
        has_required_dvns: true,
        optional_dvns: array![DVN_4],
        optional_dvn_threshold: 1,
        has_optional_dvns: true,
    };

    // Should not panic - valid configuration
    let resolved = mock.resolve(default_config, custom_config);
    assert(resolved.confirmations == 20, 'confirmations not overridden');
    assert(resolved.required_dvns == array![DVN_3], 'required_dvns not overridden');
    assert(resolved.optional_dvns == array![DVN_4], 'optional_dvns not overridden');
    assert(resolved.optional_dvn_threshold == 1, 'threshold not overridden');
}

#[test]
#[feature("safe_dispatcher")]
fn test_resolve_with_no_dvns_should_panic() {
    let (_, mock_safe) = deploy_mock_uln_config();

    let default_config = UlnConfig {
        confirmations: 10,
        has_confirmations: false,
        required_dvns: array![DVN_1],
        has_required_dvns: false,
        optional_dvns: array![DVN_2],
        optional_dvn_threshold: 1,
        has_optional_dvns: false,
    };

    let custom_config = UlnConfig {
        confirmations: 20,
        has_confirmations: false,
        required_dvns: array![],
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: true,
    };

    // Should panic during resolve because final config has no DVNs
    let result = mock_safe.resolve(default_config, custom_config);
    assert_panic_with_error(result, err_must_have_at_least_one_dvn());
}

#[test]
#[feature("safe_dispatcher")]
fn test_resolve_with_invalid_optional_threshold_too_high() {
    let (_, mock_safe) = deploy_mock_uln_config();

    let default_config = UlnConfig {
        confirmations: 10,
        has_confirmations: false,
        required_dvns: array![DVN_1],
        has_required_dvns: false,
        optional_dvns: array![DVN_2],
        optional_dvn_threshold: 1,
        has_optional_dvns: false,
    };

    let custom_config = UlnConfig {
        confirmations: 20,
        has_confirmations: false,
        required_dvns: array![DVN_3],
        has_required_dvns: true,
        optional_dvns: array![DVN_4],
        optional_dvn_threshold: 2, // Threshold is higher than available optional DVNs (1)
        has_optional_dvns: true,
    };

    // Should panic - threshold higher than available optional DVNs
    let result = mock_safe.resolve(default_config, custom_config);
    assert_panic_with_error(result, err_invalid_optional_dvn_threshold(1, 2));
}

#[test]
#[feature("safe_dispatcher")]
fn test_resolve_with_zero_threshold_but_has_optional_dvns() {
    let (_, mock_safe) = deploy_mock_uln_config();

    let default_config = UlnConfig {
        confirmations: 10,
        has_confirmations: false,
        required_dvns: array![DVN_1],
        has_required_dvns: false,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: false,
    };

    let custom_config = UlnConfig {
        confirmations: 20,
        has_confirmations: false,
        required_dvns: array![DVN_3],
        has_required_dvns: true,
        optional_dvns: array![DVN_4],
        optional_dvn_threshold: 0, // Zero threshold with optional DVNs
        has_optional_dvns: true,
    };

    // Should panic - zero threshold with optional DVNs present
    let result = mock_safe.resolve(default_config, custom_config);
    assert_panic_with_error(result, err_invalid_optional_dvn_threshold(1, 0));
}

#[test]
fn test_resolve_with_exactly_MAX_DVN_COUNT_required_dvns() {
    let (mock, _) = deploy_mock_uln_config();

    // Create an array with exactly MAX_DVN_COUNT DVNs
    let mut required_dvns = array![];
    let mut i = 1;
    while i != (MAX_DVN_COUNT.into() + 1) {
        required_dvns.append(i.try_into().unwrap());
        i += 1;
    }

    let default_config = UlnConfig {
        confirmations: 10,
        has_confirmations: false,
        required_dvns: array![DVN_1],
        has_required_dvns: false,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: false,
    };

    let custom_config = UlnConfig {
        confirmations: 20,
        has_confirmations: false,
        required_dvns,
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: false,
    };

    // Should not panic - exactly MAX_DVN_COUNT required DVNs is allowed
    let resolved = mock.resolve(default_config, custom_config);
    assert(resolved.required_dvns.len() == MAX_DVN_COUNT, 'required.len() != MAX_DVN_COUNT');
}

#[test]
fn test_resolve_with_exactly_MAX_DVN_COUNT_optional_dvns() {
    let (mock, _) = deploy_mock_uln_config();

    // Create an array with exactly MAX_DVN_COUNT DVNs
    let mut optional_dvns = array![];
    let mut i = 1;
    while i != (MAX_DVN_COUNT.into() + 1) {
        optional_dvns.append(i.try_into().unwrap());
        i += 1;
    }

    let default_config = UlnConfig {
        confirmations: 10,
        has_confirmations: false,
        required_dvns: array![DVN_1],
        has_required_dvns: false,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: false,
    };

    let custom_config = UlnConfig {
        confirmations: 20,
        has_confirmations: false,
        required_dvns: array![],
        has_required_dvns: true,
        optional_dvns,
        optional_dvn_threshold: MAX_DVN_COUNT.try_into().unwrap(),
        has_optional_dvns: true,
    };

    // Should not panic - exactly MAX_DVN_COUNT optional DVNs is allowed
    let resolved = mock.resolve(default_config, custom_config);
    assert(resolved.optional_dvns.len() == MAX_DVN_COUNT, 'optional.len() != MAX_DVN_COUNT');
    assert(
        resolved.optional_dvn_threshold == MAX_DVN_COUNT.try_into().unwrap(),
        'threshold != MAX_DVN_COUNT',
    );
}

#[test]
#[feature("safe_dispatcher")]
fn test_resolve_with_too_many_required_dvns_should_panic() {
    let (_, mock_safe) = deploy_mock_uln_config();

    // Create an array with MAX_DVN_COUNT.into() + 1 DVNs (over the limit)
    let mut required_dvns = array![];
    let mut i = 0;
    while i != (MAX_DVN_COUNT.into() + 1) {
        required_dvns.append(i.try_into().unwrap());
        i += 1;
    }

    let default_config = UlnConfig {
        confirmations: 10,
        has_confirmations: false,
        required_dvns: array![DVN_1],
        has_required_dvns: false,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: false,
    };

    let custom_config = UlnConfig {
        confirmations: 20,
        has_confirmations: false,
        required_dvns,
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: false,
    };

    // Should panic during resolve because final config has too many required DVNs
    let result = mock_safe.resolve(default_config, custom_config);
    assert_panic_with_error(result, err_too_many_dvns(MAX_DVN_COUNT.into() + 1, 0));
}

#[test]
#[feature("safe_dispatcher")]
fn test_resolve_with_too_many_optional_dvns_should_panic() {
    let (_, mock_safe) = deploy_mock_uln_config();

    let default_config = UlnConfig {
        confirmations: 10,
        has_confirmations: false,
        required_dvns: array![DVN_1],
        has_required_dvns: false,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: false,
    };

    // Create an array with MAX_DVN_COUNT.into() + 1 DVNs (over the limit)
    let mut optional_dvns = array![];
    let mut i = 0;
    while i != (MAX_DVN_COUNT.into() + 1) {
        optional_dvns.append(i.try_into().unwrap());
        i += 1;
    }

    let custom_config = UlnConfig {
        confirmations: 20,
        has_confirmations: false,
        required_dvns: array![DVN_3],
        has_required_dvns: true,
        optional_dvns,
        optional_dvn_threshold: MAX_DVN_COUNT.try_into().unwrap(),
        has_optional_dvns: true,
    };

    // Should panic during resolve because final config has too many optional DVNs
    let result = mock_safe.resolve(default_config, custom_config);
    assert_panic_with_error(result, err_too_many_dvns(1, MAX_DVN_COUNT.into() + 1));
}

#[test]
#[feature("safe_dispatcher")]
fn test_resolve_with_too_many_total_dvns_should_panic() {
    let (_, mock_safe) = deploy_mock_uln_config();

    let default_config = UlnConfig {
        confirmations: 10,
        has_confirmations: false,
        required_dvns: array![DVN_1],
        has_required_dvns: false,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: false,
    };

    // Create arrays that together exceed MAX_DVN_COUNT
    // Use half for required and half + 1 for optional to exceed the limit
    let half_max_u32: u32 = (MAX_DVN_COUNT / 2);
    let half_max: felt252 = half_max_u32.into();
    let mut required_dvns = array![];
    let mut optional_dvns = array![];

    // Add required DVNs (first half)
    let mut i = 1;
    while i != (half_max + 1) {
        required_dvns.append(i.try_into().unwrap());
        i += 1;
    }

    // Add optional DVNs (second half + 2 more to exceed limit)
    let mut j = (half_max + 1);
    while j != (MAX_DVN_COUNT.into() + 3) {
        optional_dvns.append(j.try_into().unwrap());
        j += 1;
    }

    let custom_config = UlnConfig {
        confirmations: 20,
        has_confirmations: false,
        required_dvns,
        has_required_dvns: true,
        optional_dvns,
        optional_dvn_threshold: 1,
        has_optional_dvns: true,
    };

    // Should panic during resolve because total DVN count exceeds MAX_DVN_COUNT
    let result = mock_safe.resolve(default_config, custom_config);
    assert_panic_with_error(
        result,
        err_too_many_dvns(
            half_max_u32, (MAX_DVN_COUNT.into() - half_max_u32 + 2).try_into().unwrap(),
        ),
    );
}

#[test]
fn assert_no_duplicate_dvns() {
    let dvn_1 = 1.try_into().unwrap();
    let dvn_2 = 2.try_into().unwrap();

    UlnConfigUtilsImpl::assert_no_duplicate_dvns(
        @UlnConfig {
            confirmations: 0,
            has_confirmations: false,
            required_dvns: array![dvn_1, dvn_2],
            has_required_dvns: false,
            optional_dvns: array![],
            optional_dvn_threshold: 0,
            has_optional_dvns: false,
        },
    )
}

#[test]
#[should_panic(expected: "LZ_ULN_UNSORTED_DVNS")]
fn assert_unsorted_dvns() {
    let dvn_1 = 1.try_into().unwrap();
    let dvn_2 = 2.try_into().unwrap();

    UlnConfigUtilsImpl::assert_no_duplicate_dvns(
        @UlnConfig {
            confirmations: 0,
            has_confirmations: false,
            required_dvns: array![dvn_2, dvn_1],
            has_required_dvns: false,
            optional_dvns: array![],
            optional_dvn_threshold: 0,
            has_optional_dvns: false,
        },
    )
}

#[test]
#[should_panic(expected: "LZ_ULN_UNSORTED_DVNS")]
fn assert_duplicate_dvns_at_beginning() {
    let dvn_1 = 1.try_into().unwrap();
    let dvn_2 = 2.try_into().unwrap();

    UlnConfigUtilsImpl::assert_no_duplicate_dvns(
        @UlnConfig {
            confirmations: 0,
            has_confirmations: false,
            required_dvns: array![dvn_1, dvn_1, dvn_2],
            has_required_dvns: false,
            optional_dvns: array![],
            optional_dvn_threshold: 0,
            has_optional_dvns: false,
        },
    )
}

#[test]
#[should_panic(expected: "LZ_ULN_UNSORTED_DVNS")]
fn assert_duplicate_dvns_at_end() {
    let dvn_1 = 1.try_into().unwrap();
    let dvn_2 = 2.try_into().unwrap();

    UlnConfigUtilsImpl::assert_no_duplicate_dvns(
        @UlnConfig {
            confirmations: 0,
            has_confirmations: false,
            required_dvns: array![dvn_1, dvn_2, dvn_2],
            has_required_dvns: false,
            optional_dvns: array![],
            optional_dvn_threshold: 0,
            has_optional_dvns: false,
        },
    )
}
