use crate::worker_options::test;
use hex_literal::hex;
use soroban_sdk::{Bytes, Env};

#[test]
fn test_append_dvn_option_creates_new_entries_for_different_dvn_idx() {
    let env = Env::default();
    let mut dvn_options = soroban_sdk::map![&env];

    // dvn_idx=0
    let option_idx_0 = Bytes::from_slice(&env, &hex!("0200020001"));
    // dvn_idx=2
    let option_idx_2 = Bytes::from_slice(&env, &hex!("0200020201"));

    test::append_dvn_option_for_test(&env, &mut dvn_options, option_idx_0);
    test::append_dvn_option_for_test(&env, &mut dvn_options, option_idx_2);

    assert_eq!(dvn_options.len(), 2);
    assert!(dvn_options.get(0).is_some());
    assert!(dvn_options.get(2).is_some());
}

#[test]
fn test_append_dvn_option_groups_and_appends_same_dvn_idx() {
    let env = Env::default();
    let mut dvn_options = soroban_sdk::map![&env];

    // Multiple DVN options with the same dvn_idx=0 should be concatenated
    // in encounter order.
    let option_1 = Bytes::from_slice(&env, &hex!("0200020001"));
    let option_2 = Bytes::from_slice(&env, &hex!("0200020002"));
    let option_3 = Bytes::from_slice(&env, &hex!("02000200ff"));

    test::append_dvn_option_for_test(&env, &mut dvn_options, option_1.clone());
    test::append_dvn_option_for_test(&env, &mut dvn_options, option_2.clone());
    test::append_dvn_option_for_test(&env, &mut dvn_options, option_3.clone());

    assert_eq!(dvn_options.len(), 1);

    let mut expected = option_1;
    expected.append(&option_2);
    expected.append(&option_3);
    assert_eq!(dvn_options.get(0).unwrap(), expected);
}

#[test]
fn test_append_dvn_option_supports_dvn_idx_255() {
    let env = Env::default();
    let mut dvn_options = soroban_sdk::map![&env];

    // Minimal DVN option with option_size=1 (only dvn_idx), dvn_idx=255.
    let option_idx_255 = Bytes::from_slice(&env, &hex!("020001ff"));
    test::append_dvn_option_for_test(&env, &mut dvn_options, option_idx_255.clone());

    assert_eq!(dvn_options.len(), 1);
    assert_eq!(dvn_options.get(255).unwrap(), option_idx_255);
}
