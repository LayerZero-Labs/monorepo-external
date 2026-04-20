use crate::{self as oapp, errors::OAppError, oapp_receiver::LzReceiveInternal};
use endpoint_v2::Origin;
use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token::StellarAssetClient,
    Address, Bytes, BytesN, Env, IntoVal,
};

#[oapp_macros::oapp]
#[common_macros::lz_contract]
pub struct DummyOAppReceiver;

impl LzReceiveInternal for DummyOAppReceiver {
    fn __lz_receive(
        _env: &Env,
        _origin: &Origin,
        _guid: &BytesN<32>,
        _message: &Bytes,
        _extra_data: &Bytes,
        _executor: &Address,
        _value: i128,
    ) {
        // do nothing
    }
}

#[contractimpl]
impl DummyOAppReceiver {
    pub fn __constructor(env: &Env, owner: &Address, endpoint: &Address) {
        oapp::oapp_core::init_ownable_oapp::<Self>(env, owner, endpoint, owner);
    }
}

const REMOTE_EID: u32 = 100;
const UNSET_EID: u32 = 999;

// Mock Endpoint (minimal subset used by oapp_receiver::verify_and_clear_payload)

#[contract]
pub struct MockEndpoint;

#[contractimpl]
impl MockEndpoint {
    pub fn __constructor(env: Env, native_token: Address) {
        env.storage().instance().set(&symbol_short!("ntk"), &native_token);
    }

    pub fn set_delegate(_env: Env, _oapp: &Address, _delegate: &Option<Address>) {
        // do nothing
    }

    pub fn native_token(env: Env) -> Address {
        env.storage().instance().get(&symbol_short!("ntk")).unwrap()
    }

    pub fn clear(env: Env, caller: Address, origin: Origin, receiver: Address, guid: BytesN<32>, message: Bytes) {
        // Record last clear for assertions
        env.storage().instance().set(&symbol_short!("clr_c"), &caller);
        env.storage().instance().set(&symbol_short!("clr_o"), &origin);
        env.storage().instance().set(&symbol_short!("clr_r"), &receiver);
        env.storage().instance().set(&symbol_short!("clr_g"), &guid);
        env.storage().instance().set(&symbol_short!("clr_m"), &message);
    }

    pub fn last_clear(env: Env) -> (Address, Origin, Address, BytesN<32>, Bytes) {
        (
            env.storage().instance().get(&symbol_short!("clr_c")).unwrap(),
            env.storage().instance().get(&symbol_short!("clr_o")).unwrap(),
            env.storage().instance().get(&symbol_short!("clr_r")).unwrap(),
            env.storage().instance().get(&symbol_short!("clr_g")).unwrap(),
            env.storage().instance().get(&symbol_short!("clr_m")).unwrap(),
        )
    }
}

struct TestSetup<'a> {
    env: Env,
    owner: Address,
    endpoint: Address,
    token_admin: Address,
    native_token: Address,
    native_token_admin_client: StellarAssetClient<'a>,
    oapp_client: DummyOAppReceiverClient<'a>,
}

fn setup<'a>() -> TestSetup<'a> {
    let env = Env::default();

    let owner = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let native_token_sac = env.register_stellar_asset_contract_v2(token_admin.clone());
    let native_token = native_token_sac.address();
    let native_token_admin_client = StellarAssetClient::new(&env, &native_token);

    let endpoint = env.register(MockEndpoint, (&native_token,));
    let oapp = env.register(DummyOAppReceiver, (&owner, &endpoint));
    let oapp_client = DummyOAppReceiverClient::new(&env, &oapp);

    TestSetup { env, owner, endpoint, token_admin, native_token, native_token_admin_client, oapp_client }
}

fn set_peer(env: &Env, owner: &Address, oapp_client: &DummyOAppReceiverClient<'_>, eid: u32, peer: &BytesN<32>) {
    let peer_option = Some(peer.clone());
    env.mock_auths(&[MockAuth {
        address: owner,
        invoke: &MockAuthInvoke {
            contract: &oapp_client.address,
            fn_name: "set_peer",
            args: (&eid, &peer_option, owner).into_val(env),
            sub_invokes: &[],
        },
    }]);
    oapp_client.set_peer(&eid, &peer_option, owner);
}

fn lz_receive(
    env: &Env,
    oapp_client: &DummyOAppReceiverClient<'_>,
    executor: &Address,
    origin: &Origin,
    guid: &BytesN<32>,
    message: &Bytes,
    extra_data: &Bytes,
    value: i128,
    sub_invokes: &[MockAuthInvoke<'_>],
) {
    env.mock_auths(&[MockAuth {
        address: executor,
        invoke: &MockAuthInvoke {
            contract: &oapp_client.address,
            fn_name: "lz_receive",
            args: (executor, origin, guid, message, extra_data, value).into_val(env),
            sub_invokes,
        },
    }]);
    oapp_client.lz_receive(executor, origin, guid, message, extra_data, &value);
}

#[test]
fn test_is_compose_msg_sender() {
    let TestSetup { env, oapp_client, .. } = setup();

    let origin = Origin { src_eid: REMOTE_EID, sender: BytesN::from_array(&env, &[1; 32]), nonce: 1 };
    let message = Bytes::from_array(&env, &[1, 2, 3, 4]);

    // Test with same contract address (should return true)
    let result = oapp_client.is_compose_msg_sender(&origin, &message, &oapp_client.address);
    assert_eq!(result, true);
    let different_sender = Address::generate(&env);

    // Test with different sender address (should return false)
    assert_eq!(oapp_client.is_compose_msg_sender(&origin, &message, &different_sender), false);
}

#[test]
fn test_allow_initialize_path_cases() {
    let TestSetup { env, owner, oapp_client, .. } = setup();

    // no peer set -> false
    let origin_no_peer = Origin { src_eid: UNSET_EID, sender: BytesN::from_array(&env, &[5; 32]), nonce: 1 };
    assert_eq!(oapp_client.allow_initialize_path(&origin_no_peer), false);

    // set peer for REMOTE_EID
    let peer_bytes: BytesN<32> = BytesN::from_array(&env, &[5; 32]);
    set_peer(&env, &owner, &oapp_client, REMOTE_EID, &peer_bytes);

    // matching -> true
    let origin_match = Origin { src_eid: REMOTE_EID, sender: peer_bytes.clone(), nonce: 1 };
    assert_eq!(oapp_client.allow_initialize_path(&origin_match), true);

    // non-matching -> false
    let origin_non_match = Origin { src_eid: REMOTE_EID, sender: BytesN::from_array(&env, &[6; 32]), nonce: 1 };
    assert_eq!(oapp_client.allow_initialize_path(&origin_non_match), false);
}

#[test]
fn test_lz_receive_verifies_peer_and_calls_clear_value_zero() {
    let TestSetup { env, owner, endpoint, oapp_client, .. } = setup();

    // Configure peer
    let peer: BytesN<32> = BytesN::from_array(&env, &[7; 32]);
    set_peer(&env, &owner, &oapp_client, REMOTE_EID, &peer);

    let executor = Address::generate(&env);
    let origin = Origin { src_eid: REMOTE_EID, sender: peer, nonce: 1 };
    let guid = BytesN::from_array(&env, &[2u8; 32]);
    let message = Bytes::from_array(&env, &[1, 2, 3]);
    let extra_data = Bytes::new(&env);
    lz_receive(&env, &oapp_client, &executor, &origin, &guid, &message, &extra_data, 0, &[]);

    let endpoint_client = MockEndpointClient::new(&env, &endpoint);
    let (caller, cleared_origin, receiver, cleared_guid, cleared_message) = endpoint_client.last_clear();
    assert_eq!(caller, oapp_client.address);
    assert_eq!(cleared_origin, origin);
    assert_eq!(receiver, oapp_client.address);
    assert_eq!(cleared_guid, guid);
    assert_eq!(cleared_message, message);
}

#[test]
fn test_lz_receive_transfers_native_token_when_value_positive() {
    let TestSetup { env, owner, endpoint, native_token, native_token_admin_client, token_admin, oapp_client, .. } =
        setup();

    // Configure peer
    let peer: BytesN<32> = BytesN::from_array(&env, &[9; 32]);
    set_peer(&env, &owner, &oapp_client, REMOTE_EID, &peer);

    let executor = Address::generate(&env);
    let origin = Origin { src_eid: REMOTE_EID, sender: peer, nonce: 1 };
    let guid = BytesN::from_array(&env, &[3u8; 32]);
    let message = Bytes::from_array(&env, &[4, 5, 6]);
    let extra_data = Bytes::new(&env);
    let value: i128 = 123;

    // Mint native token to executor (admin auth)
    env.mock_auths(&[MockAuth {
        address: &token_admin,
        invoke: &MockAuthInvoke {
            contract: &native_token,
            fn_name: "mint",
            args: (&executor, &value).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    native_token_admin_client.mint(&executor, &value);

    // lz_receive should transfer tokens from executor -> oapp
    let transfer_invoke = MockAuthInvoke {
        contract: &native_token,
        fn_name: "transfer",
        args: (&executor, &oapp_client.address, &value).into_val(&env),
        sub_invokes: &[],
    };
    let sub_invokes = [transfer_invoke];
    lz_receive(&env, &oapp_client, &executor, &origin, &guid, &message, &extra_data, value, &sub_invokes);

    let endpoint_client = MockEndpointClient::new(&env, &endpoint);
    // Asserts clear() was called (last_clear() will panic if not)
    endpoint_client.last_clear();

    let token_client = soroban_sdk::token::TokenClient::new(&env, &native_token);
    assert_eq!(token_client.balance(&executor), 0);
    assert_eq!(token_client.balance(&oapp_client.address), value);
}

#[test]
fn test_lz_receive_rejects_negative_value_and_does_not_clear() {
    let TestSetup { env, owner, endpoint, native_token, native_token_admin_client, token_admin, oapp_client, .. } =
        setup();

    // Configure peer
    let peer: BytesN<32> = BytesN::from_array(&env, &[9; 32]);
    set_peer(&env, &owner, &oapp_client, REMOTE_EID, &peer);

    let executor = Address::generate(&env);
    let origin = Origin { src_eid: REMOTE_EID, sender: peer, nonce: 1 };
    let guid = BytesN::from_array(&env, &[3u8; 32]);
    let message = Bytes::from_array(&env, &[4, 5, 6]);
    let extra_data = Bytes::new(&env);
    let value: i128 = -123;

    // Fund executor with a positive balance so the only failure is the negative amount.
    env.mock_auths(&[MockAuth {
        address: &token_admin,
        invoke: &MockAuthInvoke {
            contract: &native_token,
            fn_name: "mint",
            args: (&executor, &(-value)).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    native_token_admin_client.mint(&executor, &(-value));

    // lz_receive should attempt transfer with a negative value and fail.
    let transfer_invoke = MockAuthInvoke {
        contract: &native_token,
        fn_name: "transfer",
        args: (&executor, &oapp_client.address, &value).into_val(&env),
        sub_invokes: &[],
    };
    let sub_invokes = [transfer_invoke];
    env.mock_auths(&[MockAuth {
        address: &executor,
        invoke: &MockAuthInvoke {
            contract: &oapp_client.address,
            fn_name: "lz_receive",
            args: (&executor, &origin, &guid, &message, &extra_data, &value).into_val(&env),
            sub_invokes: &sub_invokes,
        },
    }]);

    let result = oapp_client.try_lz_receive(&executor, &origin, &guid, &message, &extra_data, &value);
    assert_eq!(result.err().unwrap().ok().unwrap(), soroban_sdk::Error::from_contract_error(8)); //negative amount is not allowed

    // No balances changed.
    let token_client = soroban_sdk::token::TokenClient::new(&env, &native_token);
    assert_eq!(token_client.balance(&executor), -value);
    assert_eq!(token_client.balance(&oapp_client.address), 0);

    // Payload should not have been cleared.
    let endpoint_client = MockEndpointClient::new(&env, &endpoint);
    assert!(endpoint_client.try_last_clear().is_err());
}

#[test]
fn test_next_nonce_defaults_to_zero() {
    let TestSetup { env, oapp_client, .. } = setup();
    let sender = BytesN::from_array(&env, &[1u8; 32]);
    assert_eq!(oapp_client.next_nonce(&REMOTE_EID, &sender), 0);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_lz_receive_requires_executor_auth() {
    let TestSetup { env, owner, oapp_client, .. } = setup();

    let peer: BytesN<32> = BytesN::from_array(&env, &[7; 32]);
    set_peer(&env, &owner, &oapp_client, REMOTE_EID, &peer);

    // Call without executor auth mocked -> should fail at executor.require_auth()
    let executor = Address::generate(&env);
    let origin = Origin { src_eid: REMOTE_EID, sender: peer, nonce: 1 };
    let guid = BytesN::from_array(&env, &[2u8; 32]);
    let message = Bytes::from_array(&env, &[1, 2, 3]);
    let extra_data = Bytes::new(&env);
    oapp_client.lz_receive(&executor, &origin, &guid, &message, &extra_data, &0);
}

#[test]
fn test_lz_receive_wrong_peer_returns_only_peer_error() {
    let TestSetup { env, owner, oapp_client, .. } = setup();

    let configured_peer: BytesN<32> = BytesN::from_array(&env, &[7; 32]);
    set_peer(&env, &owner, &oapp_client, REMOTE_EID, &configured_peer);

    let executor = Address::generate(&env);
    let wrong_sender: BytesN<32> = BytesN::from_array(&env, &[8; 32]);
    let origin = Origin { src_eid: REMOTE_EID, sender: wrong_sender, nonce: 1 };
    let guid = BytesN::from_array(&env, &[2u8; 32]);
    let message = Bytes::from_array(&env, &[1, 2, 3]);
    let extra_data = Bytes::new(&env);
    let value: i128 = 0;

    env.mock_auths(&[MockAuth {
        address: &executor,
        invoke: &MockAuthInvoke {
            contract: &oapp_client.address,
            fn_name: "lz_receive",
            args: (&executor, &origin, &guid, &message, &extra_data, &value).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let result = oapp_client.try_lz_receive(&executor, &origin, &guid, &message, &extra_data, &value);
    assert_eq!(result.err().unwrap().ok().unwrap(), OAppError::OnlyPeer.into());
}

#[test]
fn test_lz_receive_no_peer_returns_no_peer_error() {
    let TestSetup { env, oapp_client, .. } = setup();

    let executor = Address::generate(&env);
    let origin = Origin { src_eid: REMOTE_EID, sender: BytesN::from_array(&env, &[1; 32]), nonce: 1 };
    let guid = BytesN::from_array(&env, &[2u8; 32]);
    let message = Bytes::from_array(&env, &[1, 2, 3]);
    let extra_data = Bytes::new(&env);
    let value: i128 = 0;

    env.mock_auths(&[MockAuth {
        address: &executor,
        invoke: &MockAuthInvoke {
            contract: &oapp_client.address,
            fn_name: "lz_receive",
            args: (&executor, &origin, &guid, &message, &extra_data, &value).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    // No peer configured -> should fail with NoPeer since no peer is set for the source eid
    let result = oapp_client.try_lz_receive(&executor, &origin, &guid, &message, &extra_data, &value);
    assert_eq!(result.err().unwrap().ok().unwrap(), OAppError::NoPeer.into());
}
