extern crate std;

use endpoint_v2::{MessagingFee, MessagingParams, MessagingReceipt, Origin};
use soroban_sdk::{
    contract, contractimpl, log, symbol_short,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, Bytes, BytesN, Env, IntoVal,
};

use crate::{
    codec::{self, MsgType},
    counter::{Counter, CounterClient},
    errors::CounterError,
    tests::mint_to,
};

struct TestSetup<'a> {
    env: Env,
    owner: Address,
    counter: CounterClient<'a>,
    endpoint: Address,
    native_token: Address,
}

#[contract]
pub struct DummyEndpoint;

#[contractimpl]
impl DummyEndpoint {
    pub fn __constructor(env: Env, native_token: Address) {
        env.storage().instance().set(&symbol_short!("ntk"), &native_token);
    }

    pub fn set_delegate(_env: Env, _oapp: Address, _delegate: Address) {
        // do nothing
    }

    pub fn eid(_env: Env) -> u32 {
        100
    }

    pub fn native_token(env: Env) -> Address {
        env.storage().instance().get(&symbol_short!("ntk")).unwrap()
    }

    pub fn send(env: Env, _sender: Address, _params: MessagingParams, _refund_address: Address) -> MessagingReceipt {
        MessagingReceipt {
            guid: BytesN::from_array(&env, &[1u8; 32]),
            nonce: 1,
            fee: MessagingFee { native_fee: 100, zro_fee: 0 },
        }
    }

    pub fn skip(_env: Env, _caller: Address, _receiver: Address, _src_eid: u32, _sender: BytesN<32>, _nonce: u64) {
        // do nothing
    }

    pub fn clear(_env: Env, _caller: Address, _origin: Origin, _receiver: Address, _guid: BytesN<32>, _message: Bytes) {
        // do nothing
    }

    pub fn clear_compose(
        _env: Env,
        _composer: Address,
        _from: Address,
        _guid: BytesN<32>,
        _index: u32,
        _message: Bytes,
    ) {
        // do nothing
    }
}

fn setup<'a>() -> TestSetup<'a> {
    let env = Env::default();
    let owner = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(owner.clone());

    let endpoint = env.register(DummyEndpoint, (&sac.address(),));
    let counter = env.register(Counter, (&owner, &endpoint, &owner));
    let counter_client = CounterClient::new(&env, &counter);

    log!(&env, "native_token: {}", sac.address());
    log!(&env, "endpoint: {}", endpoint);
    log!(&env, "counter: {}", counter);

    TestSetup { env, owner, counter: counter_client, endpoint, native_token: sac.address() }
}

fn setup_mock_peer(env: &Env, owner: &Address, counter: &CounterClient<'_>, dst_eid: u32) -> BytesN<32> {
    let peer = BytesN::from_array(env, &[1u8; 32]);
    let peer_option = Some(peer.clone());
    env.mock_auths(&[MockAuth {
        address: owner,
        invoke: &MockAuthInvoke {
            contract: &counter.address,
            fn_name: "set_peer",
            args: (&dst_eid, &peer_option, owner).into_val(env),
            sub_invokes: &[],
        },
    }]);
    counter.set_peer(&dst_eid, &peer_option, owner);
    peer
}

fn set_ordered_nonce(env: &Env, owner: &Address, counter: &CounterClient<'_>, ordered_nonce: bool) {
    env.mock_auths(&[MockAuth {
        address: owner,
        invoke: &MockAuthInvoke {
            contract: &counter.address,
            fn_name: "set_ordered_nonce",
            args: (&ordered_nonce,).into_val(env),
            sub_invokes: &[],
        },
    }]);

    counter.set_ordered_nonce(&ordered_nonce);
}

// tests for major entry functions

#[test]
fn test_increment() {
    let TestSetup { env, owner, counter, endpoint, native_token, .. } = setup();

    let sender = Address::generate(&env);
    let dst_eid = 101;
    let msg_type = MsgType::Vanilla;
    let fee = MessagingFee { native_fee: 100, zro_fee: 0 };

    setup_mock_peer(&env, &owner, &counter, dst_eid);
    mint_to(&env, &owner, &native_token, &sender, fee.native_fee);

    env.mock_auths(&[MockAuth {
        address: &sender,
        invoke: &MockAuthInvoke {
            contract: &counter.address,
            fn_name: "increment",
            args: (&sender, &dst_eid, &(msg_type as u32), &Bytes::new(&env), &fee).into_val(&env),
            sub_invokes: &[MockAuthInvoke {
                contract: &native_token,
                fn_name: "transfer",
                args: (&sender, &endpoint, &fee.native_fee).into_val(&env),
                sub_invokes: &[],
            }],
        },
    }]);
    counter.increment(&sender, &dst_eid, &(msg_type as u32), &Bytes::new(&env), &fee);

    assert_eq!(counter.outbound_count(&dst_eid), 1);
}

#[test]
fn test_lz_receive_vanilla() {
    let TestSetup { env, owner, counter, native_token, .. } = setup();

    let origin = Origin { src_eid: 101, sender: BytesN::from_array(&env, &[1u8; 32]), nonce: 1 };
    let guid = BytesN::from_array(&env, &[2u8; 32]);
    let value = 100;
    let message = codec::encode_with_value(&env, MsgType::Vanilla, origin.src_eid, value);
    let executor = Address::generate(&env);
    let extra_data = Bytes::new(&env);

    setup_mock_peer(&env, &owner, &counter, origin.src_eid);

    mint_to(&env, &owner, &native_token, &executor, value as i128);

    let sub_invokes_with_transfer = MockAuthInvoke {
        contract: &native_token,
        fn_name: "transfer",
        args: (&executor, &counter.address, &(value as i128)).into_val(&env),
        sub_invokes: &[],
    };
    env.mock_auths(&[MockAuth {
        address: &executor,
        invoke: &MockAuthInvoke {
            contract: &counter.address,
            fn_name: "lz_receive",
            args: (&executor, &origin, &guid, &message, &extra_data, &(value as i128)).into_val(&env),
            sub_invokes: &[sub_invokes_with_transfer],
        },
    }]);

    counter.lz_receive(&executor, &origin, &guid, &message, &extra_data, &(value as i128));

    assert_eq!(counter.count(), 1);
    assert_eq!(counter.inbound_count(&origin.src_eid), 1);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_lz_receive_not_from_executor() {
    let TestSetup { env, owner, counter, .. } = setup();

    let origin = Origin { src_eid: 101, sender: BytesN::from_array(&env, &[1u8; 32]), nonce: 1 };
    let guid = BytesN::from_array(&env, &[2u8; 32]);
    let value = 100;
    let message = codec::encode_with_value(&env, MsgType::Vanilla, origin.src_eid, value);
    let executor = Address::generate(&env);
    let extra_data = Bytes::new(&env);

    setup_mock_peer(&env, &owner, &counter, origin.src_eid);
    counter.lz_receive(&executor, &origin, &guid, &message, &extra_data, &(value as i128));
}

#[test]
fn test_lz_receive_vanilla_ordered_nonce_wrong_nonce() {
    let TestSetup { env, owner, counter, native_token, .. } = setup();

    // next nonce should be 1 instead of 999
    let origin = Origin { src_eid: 101, sender: BytesN::from_array(&env, &[1u8; 32]), nonce: 999 };
    let guid = BytesN::from_array(&env, &[2u8; 32]);
    let value = 100;
    let message = codec::encode_with_value(&env, MsgType::Vanilla, origin.src_eid, value);
    let executor = Address::generate(&env);
    let extra_data = Bytes::new(&env);

    setup_mock_peer(&env, &owner, &counter, origin.src_eid);
    mint_to(&env, &owner, &native_token, &executor, value as i128);

    let sub_invokes_with_transfer = MockAuthInvoke {
        contract: &native_token,
        fn_name: "transfer",
        args: (&executor, &counter.address, &(value as i128)).into_val(&env),
        sub_invokes: &[],
    };
    set_ordered_nonce(&env, &owner, &counter, true);

    env.mock_auths(&[MockAuth {
        address: &executor,
        invoke: &MockAuthInvoke {
            contract: &counter.address,
            fn_name: "lz_receive",
            args: (&executor, &origin, &guid, &message, &extra_data, &(value as i128)).into_val(&env),
            sub_invokes: &[sub_invokes_with_transfer],
        },
    }]);

    let result = counter.try_lz_receive(&executor, &origin, &guid, &message, &extra_data, &(value as i128));
    assert_eq!(result.err().unwrap().ok().unwrap(), CounterError::OAppInvalidNonce.into());
}

#[test]
fn test_lz_compose() {
    let TestSetup { env, owner, counter, native_token, .. } = setup();

    let from = Address::generate(&env);
    let origin = Origin { src_eid: 101, sender: BytesN::from_array(&env, &[1u8; 32]), nonce: 1 };
    let guid = BytesN::from_array(&env, &[2u8; 32]);
    let value = 100;
    let message = codec::encode_with_value(&env, MsgType::Composed, origin.src_eid, value);
    let executor = Address::generate(&env);
    let extra_data = Bytes::new(&env);

    mint_to(&env, &owner, &native_token, &executor, value as i128);
    let sub_invokes_with_transfer = MockAuthInvoke {
        contract: &native_token,
        fn_name: "transfer",
        args: (&executor, &counter.address, &(value as i128)).into_val(&env),
        sub_invokes: &[],
    };
    env.mock_auths(&[MockAuth {
        address: &executor,
        invoke: &MockAuthInvoke {
            contract: &counter.address,
            fn_name: "lz_compose",
            args: (&executor, &from, &guid, &0_u32, &message, &extra_data, &(value as i128)).into_val(&env),
            sub_invokes: &[sub_invokes_with_transfer],
        },
    }]);

    counter.lz_compose(&executor, &from, &guid, &0, &message, &extra_data, &(value as i128));

    assert_eq!(counter.composed_count(), 1);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_lz_compose_not_from_executor() {
    let TestSetup { env, counter, .. } = setup();

    let from = Address::generate(&env);
    let origin = Origin { src_eid: 101, sender: BytesN::from_array(&env, &[1u8; 32]), nonce: 1 };
    let guid = BytesN::from_array(&env, &[2u8; 32]);
    let value = 100;
    let message = codec::encode_with_value(&env, MsgType::Composed, origin.src_eid, value);
    let executor = Address::generate(&env);
    let extra_data = Bytes::new(&env);

    counter.lz_compose(&executor, &from, &guid, &0, &message, &extra_data, &(value as i128));
}

#[test]
fn test_lz_compose_aba() {
    let TestSetup { env, owner, counter, native_token, .. } = setup();

    let from = Address::generate(&env);
    let origin = Origin { src_eid: 101, sender: BytesN::from_array(&env, &[1u8; 32]), nonce: 1 };
    let guid = BytesN::from_array(&env, &[2u8; 32]);
    let value = 100;
    let message = codec::encode_with_value(&env, MsgType::ComposedABA, origin.src_eid, value);
    let executor = Address::generate(&env);
    let extra_data = Bytes::new(&env);

    setup_mock_peer(&env, &owner, &counter, origin.src_eid);
    mint_to(&env, &owner, &native_token, &executor, value as i128);
    let sub_invokes_with_transfer = MockAuthInvoke {
        contract: &native_token,
        fn_name: "transfer",
        args: (&executor, &counter.address, &(value as i128)).into_val(&env),
        sub_invokes: &[],
    };
    env.mock_auths(&[MockAuth {
        address: &executor,
        invoke: &MockAuthInvoke {
            contract: &counter.address,
            fn_name: "lz_compose",
            args: (&executor, &from, &guid, &0_u32, &message, &extra_data, &(value as i128)).into_val(&env),
            sub_invokes: &[sub_invokes_with_transfer],
        },
    }]);

    counter.lz_compose(&executor, &from, &guid, &0_u32, &message, &extra_data, &(value as i128));

    assert_eq!(counter.composed_count(), 1);
    assert_eq!(counter.outbound_count(&origin.src_eid), 1);
}

// tests for one step functions

#[test]
fn test_next_nonce() {
    let TestSetup { env, owner, counter, .. } = setup();

    let src_eid = 101;
    let sender = BytesN::from_array(&env, &[1u8; 32]);
    let nonce = counter.next_nonce(&src_eid, &sender);
    assert_eq!(nonce, 0);

    set_ordered_nonce(&env, &owner, &counter, true);
    let nonce = counter.next_nonce(&src_eid, &sender);
    assert_eq!(nonce, 1);
}

#[test]
fn test_skip_inbound_nonce() {
    let TestSetup { env, owner, counter, .. } = setup();

    let src_eid = 101;
    let sender = BytesN::from_array(&env, &[1u8; 32]);
    let nonce = 1;

    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &counter.address,
            fn_name: "skip_inbound_nonce",
            args: (&src_eid, &sender, &nonce).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    counter.skip_inbound_nonce(&src_eid, &sender, &nonce);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_skip_inbound_nonce_no_owner() {
    let TestSetup { env, counter, .. } = setup();

    let src_eid = 101;
    let sender = BytesN::from_array(&env, &[1u8; 32]);
    let nonce = 1;

    let non_owner = Address::generate(&env);
    env.mock_auths(&[MockAuth {
        address: &non_owner,
        invoke: &MockAuthInvoke {
            contract: &counter.address,
            fn_name: "skip_inbound_nonce",
            args: (&src_eid, &sender, &nonce).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    counter.skip_inbound_nonce(&src_eid, &sender, &nonce);
}
