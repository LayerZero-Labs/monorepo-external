//! OApp options type 3 tests

use layerzero::oapps::common::oapp_options_type_3::interface::{
    IOAppOptionsType3Dispatcher, IOAppOptionsType3DispatcherTrait,
};
use layerzero::oapps::common::oapp_options_type_3::structs::EnforcedOptionParam;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::{ContractAddress, SyscallResultTrait};

// Helpers
fn setup() -> (ContractAddress, IOAppOptionsType3Dispatcher, ContractAddress) {
    let owner: ContractAddress = 0x123.try_into().unwrap();
    let contract = declare("MockOAppOptionsType3").unwrap_syscall().contract_class();
    let constructor_calldata = array![owner.into()];
    let (contract_address, _) = contract.deploy(@constructor_calldata).unwrap_syscall();
    let dispatcher = IOAppOptionsType3Dispatcher { contract_address };
    (contract_address, dispatcher, owner)
}

fn create_type3_options() -> ByteArray {
    let mut options: ByteArray = Default::default();
    // Type 3 prefix (2 bytes)
    options.append_byte(0x00);
    options.append_byte(0x03);
    // Some example option data
    options.append_byte(0x01); // worker id
    options.append_byte(0x00); // option size high byte
    options.append_byte(0x05); // option size low byte (5 bytes)
    options.append_byte(0x01); // option type
    options.append_byte(0x00); // gas high byte
    options.append_byte(0x00); // gas mid-high byte
    options.append_byte(0x03); // gas mid-low byte  
    options.append_byte(0xe8); // gas low byte (1000 in decimal)
    options
}

fn create_invalid_type2_options() -> ByteArray {
    let mut options: ByteArray = Default::default();
    // Type 2 prefix (invalid for enforced options)
    options.append_byte(0x00);
    options.append_byte(0x02);
    // Some option data
    options.append_byte(0x01);
    options.append_byte(0x02);
    options
}

fn create_exactly_two_byte_type3_options() -> ByteArray {
    let mut options: ByteArray = Default::default();
    options.append_byte(0x00);
    options.append_byte(0x03);
    options
}

#[test]
fn test_set_enforced_options_success() {
    let (contract_address, dispatcher, owner) = setup();

    start_cheat_caller_address(contract_address, owner);

    let options = create_type3_options();
    let enforced_options = array![
        EnforcedOptionParam { eid: 1, msg_type: 1, options: options.clone() },
        EnforcedOptionParam { eid: 2, msg_type: 2, options: options.clone() },
    ];

    dispatcher.set_enforced_options(enforced_options);

    // Verify the options were set
    let retrieved_options = dispatcher.get_enforced_options(1, 1);
    assert!(retrieved_options == options, "Options should match");

    let retrieved_options2 = dispatcher.get_enforced_options(2, 2);
    assert!(retrieved_options2 == options, "Options should match");

    stop_cheat_caller_address(contract_address);
}

#[test]
#[should_panic(expected: ('Caller is not the owner',))]
fn test_set_enforced_options_only_owner() {
    let (contract_address, dispatcher, _owner) = setup();

    let non_owner: ContractAddress = 0x456.try_into().unwrap();
    start_cheat_caller_address(contract_address, non_owner);

    let options = create_type3_options();
    let enforced_options = array![EnforcedOptionParam { eid: 1, msg_type: 1, options }];

    dispatcher.set_enforced_options(enforced_options);

    stop_cheat_caller_address(contract_address);
}

#[test]
#[should_panic]
fn test_set_enforced_options_invalid_type() {
    let (contract_address, dispatcher, owner) = setup();

    start_cheat_caller_address(contract_address, owner);

    let invalid_options = create_invalid_type2_options();
    let enforced_options = array![
        EnforcedOptionParam { eid: 1, msg_type: 1, options: invalid_options },
    ];

    dispatcher.set_enforced_options(enforced_options);

    stop_cheat_caller_address(contract_address);
}

#[test]
fn test_set_enforced_options_overwrite() {
    let (contract_address, dispatcher, owner) = setup();

    start_cheat_caller_address(contract_address, owner);

    // Set initial options
    let initial_options = create_type3_options();
    let enforced_options1 = array![
        EnforcedOptionParam { eid: 1, msg_type: 1, options: initial_options.clone() },
    ];
    dispatcher.set_enforced_options(enforced_options1);

    // Verify initial options are set
    let retrieved_options = dispatcher.get_enforced_options(1, 1);
    assert!(retrieved_options == initial_options, "Initial options should match");

    // Overwrite with new options
    let new_options = create_exactly_two_byte_type3_options();
    let enforced_options2 = array![
        EnforcedOptionParam { eid: 1, msg_type: 1, options: new_options.clone() },
    ];
    dispatcher.set_enforced_options(enforced_options2);

    // Verify options were overwritten
    let retrieved_options = dispatcher.get_enforced_options(1, 1);
    assert!(retrieved_options == new_options, "Options should be overwritten");

    stop_cheat_caller_address(contract_address);
}

#[test]
fn test_combine_options_no_enforced() {
    let (_contract_address, dispatcher, _owner) = setup();

    let extra_options = create_type3_options();
    let result = dispatcher.combine_options(1, 1, extra_options.clone());

    assert!(result == extra_options, "Should return extra options when no enforced options");
}

#[test]
fn test_combine_options_no_extra() {
    let (contract_address, dispatcher, owner) = setup();

    start_cheat_caller_address(contract_address, owner);

    let enforced_options_data = create_type3_options();
    let enforced_options = array![
        EnforcedOptionParam { eid: 1, msg_type: 1, options: enforced_options_data.clone() },
    ];

    dispatcher.set_enforced_options(enforced_options);

    let empty_extra: ByteArray = Default::default();
    let result = dispatcher.combine_options(1, 1, empty_extra);

    assert!(
        result == enforced_options_data, "Should return enforced options when no extra options",
    );

    stop_cheat_caller_address(contract_address);
}

#[test]
fn test_combine_options_both_present() {
    let (contract_address, dispatcher, owner) = setup();

    start_cheat_caller_address(contract_address, owner);

    let enforced_options_data = create_type3_options();
    let enforced_options = array![
        EnforcedOptionParam { eid: 1, msg_type: 1, options: enforced_options_data.clone() },
    ];

    dispatcher.set_enforced_options(enforced_options);

    let extra_options = create_type3_options();
    let result = dispatcher.combine_options(1, 1, extra_options.clone());

    // Result should be enforced + extra (without the type prefix from extra)
    let mut expected = enforced_options_data.clone();
    let mut i = 2; // Skip the first 2 bytes (type prefix) from extra options
    while i < extra_options.len() {
        if let Option::Some(byte) = extra_options.at(i) {
            expected.append_byte(byte);
        }
        i += 1;
    }

    assert!(result == expected, "Should combine enforced and extra options");

    stop_cheat_caller_address(contract_address);
}

#[test]
#[should_panic]
fn test_combine_options_invalid_extra_options() {
    let (contract_address, dispatcher, owner) = setup();

    start_cheat_caller_address(contract_address, owner);

    let enforced_options_data = create_type3_options();
    let enforced_options = array![
        EnforcedOptionParam { eid: 1, msg_type: 1, options: enforced_options_data },
    ];

    dispatcher.set_enforced_options(enforced_options);

    let invalid_extra = create_invalid_type2_options();
    dispatcher.combine_options(1, 1, invalid_extra);

    stop_cheat_caller_address(contract_address);
}

#[test]
fn test_combine_options_extra_exactly_two_bytes() {
    let (contract_address, dispatcher, owner) = setup();

    start_cheat_caller_address(contract_address, owner);

    let enforced_options_data = create_type3_options();
    let enforced_options = array![
        EnforcedOptionParam { eid: 1, msg_type: 1, options: enforced_options_data.clone() },
    ];

    dispatcher.set_enforced_options(enforced_options);

    let two_byte_extra = create_exactly_two_byte_type3_options();
    let result = dispatcher.combine_options(1, 1, two_byte_extra);

    // Should return just enforced options since extra has no data after type prefix
    assert!(result == enforced_options_data, "Should return only enforced options");

    stop_cheat_caller_address(contract_address);
}

#[test]
fn test_get_enforced_options_empty() {
    let (_contract_address, dispatcher, _owner) = setup();

    let result = dispatcher.get_enforced_options(999, 999);
    let empty: ByteArray = Default::default();

    assert!(result == empty, "Should return empty for non-existent options");
}

#[test]
fn test_get_enforced_options_existing() {
    let (contract_address, dispatcher, owner) = setup();

    start_cheat_caller_address(contract_address, owner);

    let options = create_type3_options();
    let enforced_options = array![
        EnforcedOptionParam { eid: 1, msg_type: 1, options: options.clone() },
    ];

    dispatcher.set_enforced_options(enforced_options);

    let retrieved = dispatcher.get_enforced_options(1, 1);
    assert!(retrieved == options, "Should retrieve correct options");

    stop_cheat_caller_address(contract_address);
}
