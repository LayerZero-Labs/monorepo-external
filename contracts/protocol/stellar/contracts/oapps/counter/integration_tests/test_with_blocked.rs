use crate::{
    codec::MsgType,
    integration_tests::{setup_sml::*, utils::*},
};
use blocked_message_lib::{BlockedMessageLib, BlockedMessageLibError};
use endpoint_v2::MessagingFee;
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, Bytes, IntoVal,
};

#[test]
fn test_blocked_message_lib_quote_fails() {
    let TestSetup { env, chain_a, chain_b } = wired_setup();

    // Deploy and configure BlockedMessageLib as Chain A's send library to Chain B.
    let blocked_lib = env.register(BlockedMessageLib, ());
    register_library(&env, &chain_a.owner, &chain_a.endpoint, &blocked_lib);
    set_default_send_library(&env, &chain_a.owner, &chain_a.endpoint, chain_b.eid, &blocked_lib);

    let options = Bytes::new(&env);
    let msg_type = MsgType::Vanilla as u32;

    let result = chain_a.counter.try_quote(&chain_b.eid, &msg_type, &options, &false);
    assert_eq!(result.unwrap_err().unwrap(), BlockedMessageLibError::NotImplemented.into());
}

#[test]
fn test_blocked_message_lib_send_fails() {
    let TestSetup { env, chain_a, chain_b } = wired_setup();

    // Deploy and configure BlockedMessageLib as Chain A's send library to Chain B.
    let blocked_lib = env.register(BlockedMessageLib, ());
    register_library(&env, &chain_a.owner, &chain_a.endpoint, &blocked_lib);
    set_default_send_library(&env, &chain_a.owner, &chain_a.endpoint, chain_b.eid, &blocked_lib);

    let sender = Address::generate(&env);
    let options = Bytes::new(&env);
    let msg_type = MsgType::Vanilla as u32;

    // We can't quote (blocked), so pass a zero-fee payment. The send should still fail inside the send library.
    let fee = MessagingFee { native_fee: 0, zro_fee: 0 };

    env.mock_auths(&[MockAuth {
        address: &sender,
        invoke: &MockAuthInvoke {
            contract: &chain_a.counter.address,
            fn_name: "increment",
            args: (&sender, &chain_b.eid, &msg_type, &options, &fee).into_val(&env),
            sub_invokes: &[MockAuthInvoke {
                contract: &chain_a.native_token,
                fn_name: "transfer",
                args: (&sender, &chain_a.endpoint.address, &fee.native_fee).into_val(&env),
                sub_invokes: &[],
            }],
        },
    }]);

    let result = chain_a.counter.try_increment(&sender, &chain_b.eid, &msg_type, &options, &fee);
    assert_eq!(result.unwrap_err().unwrap(), BlockedMessageLibError::NotImplemented.into());

    // Ensure no packet was emitted.
    assert!(scan_packet_sent_event(&env, &chain_a.endpoint.address).is_none());

    // State should be rolled back (outbound count unchanged).
    assert_eq!(chain_a.counter.outbound_count(&chain_b.eid), 0);
}
