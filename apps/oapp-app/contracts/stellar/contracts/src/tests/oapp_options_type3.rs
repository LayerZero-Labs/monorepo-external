use crate::{
    self as oapp,
    errors::OAppError,
    oapp_core::OAppCore,
    oapp_options_type3::{EnforcedOptionParam, EnforcedOptionSet},
    oapp_receiver::{LzReceiveInternal, OAppReceiver},
};
use common_macros::contract_impl;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    vec, Address, Bytes, BytesN, Env, IntoVal,
};
use utils::testing_utils::assert_eq_event;

const OPTION_TYPE_3: u32 = 3;
const REMOTE_EID_1: u32 = 100;
const REMOTE_EID_2: u32 = 200;
const MSG_TYPE_SEND: u32 = 1;
const MSG_TYPE_RECEIVE: u32 = 2;

#[contract]
pub struct DummyEndpoint;

#[contractimpl]
impl DummyEndpoint {
    pub fn set_delegate(_env: Env, _oapp: &Address, _delegate: &Option<Address>) {
        // do nothing
    }
}

#[oapp_macros::oapp(custom = [core, sender, receiver])]
#[common_macros::lz_contract]
pub struct DummyOAppOptionsType3;

#[contract_impl(contracttrait)]
impl utils::rbac::RoleBasedAccessControl for DummyOAppOptionsType3 {}

#[contract_impl(contracttrait)]
impl OAppCore for DummyOAppOptionsType3 {}

impl LzReceiveInternal for DummyOAppOptionsType3 {
    fn __lz_receive(
        _env: &Env,
        _origin: &endpoint_v2::Origin,
        _guid: &BytesN<32>,
        _message: &Bytes,
        _extra_data: &Bytes,
        _executor: &Address,
        _value: i128,
    ) {
        // Dummy implementation for testing
    }
}

#[contract_impl(contracttrait)]
impl OAppReceiver for DummyOAppOptionsType3 {}

#[contract_impl]
impl DummyOAppOptionsType3 {
    pub fn __constructor(env: &Env, owner: &Address, endpoint: &Address, delegate: &Address) {
        oapp::oapp_core::init_ownable_oapp::<Self>(env, owner, endpoint, delegate);
    }
}

struct TestSetup<'a> {
    env: Env,
    owner: Address,
    oapp_client: DummyOAppOptionsType3Client<'a>,
}

fn setup<'a>() -> TestSetup<'a> {
    let env = Env::default();

    let owner = Address::generate(&env);
    let endpoint = env.register(DummyEndpoint, ());
    let delegate = owner.clone();
    let oapp = env.register(DummyOAppOptionsType3, (&owner, &endpoint, &delegate));
    let oapp_client = DummyOAppOptionsType3Client::new(&env, &oapp);

    TestSetup { env, owner, oapp_client }
}

fn create_valid_options(env: &Env, data: &[u8]) -> Bytes {
    let mut buffer = Bytes::from_array(env, &(OPTION_TYPE_3 as u16).to_be_bytes());
    buffer.extend_from_slice(data);
    buffer
}

fn set_enforced_options_with_auth(
    env: &Env,
    signer: &Address,
    oapp_client: &DummyOAppOptionsType3Client<'_>,
    enforced_params: &soroban_sdk::Vec<EnforcedOptionParam>,
) {
    env.mock_auths(&[MockAuth {
        address: signer,
        invoke: &MockAuthInvoke {
            contract: &oapp_client.address,
            fn_name: "set_enforced_options",
            args: (enforced_params, signer).into_val(env),
            sub_invokes: &[],
        },
    }]);
    oapp_client.set_enforced_options(enforced_params, signer);
}

#[test]
fn test_enforced_options_lifecycle() {
    let TestSetup { env, owner, oapp_client, .. } = setup();

    // Unset returns None
    assert_eq!(oapp_client.enforced_options(&999, &999), None);

    // Set enforced options for different eid/msg_type combinations
    let enforced1 = create_valid_options(&env, &[1, 2, 3, 4]);
    let enforced2 = create_valid_options(&env, &[5, 6, 7, 8]);
    let enforced_params = vec![
        &env,
        EnforcedOptionParam { eid: REMOTE_EID_1, msg_type: MSG_TYPE_SEND, options: Some(enforced1.clone()) },
        EnforcedOptionParam { eid: REMOTE_EID_2, msg_type: MSG_TYPE_RECEIVE, options: Some(enforced2.clone()) },
    ];
    set_enforced_options_with_auth(&env, &owner, &oapp_client, &enforced_params);

    // assert events
    assert_eq_event(&env, &oapp_client.address, EnforcedOptionSet { enforced_options: enforced_params.clone() });

    // Verify options were set correctly
    assert_eq!(oapp_client.enforced_options(&REMOTE_EID_1, &MSG_TYPE_SEND), Some(enforced1.clone()));
    assert_eq!(oapp_client.enforced_options(&REMOTE_EID_2, &MSG_TYPE_RECEIVE), Some(enforced2.clone()));

    // Update enforced options for one combination
    let updated = create_valid_options(&env, &[9, 8, 7, 6, 5]);
    let update_params =
        vec![&env, EnforcedOptionParam { eid: REMOTE_EID_1, msg_type: MSG_TYPE_SEND, options: Some(updated.clone()) }];
    set_enforced_options_with_auth(&env, &owner, &oapp_client, &update_params);
    assert_eq_event(&env, &oapp_client.address, EnforcedOptionSet { enforced_options: update_params.clone() });
    assert_eq!(oapp_client.enforced_options(&REMOTE_EID_1, &MSG_TYPE_SEND), Some(updated));
}

#[test]
fn test_combine_options() {
    let TestSetup { env, owner, oapp_client, .. } = setup();

    // combine_options: no enforced -> returns extra (including empty)
    let extra_only = create_valid_options(&env, &[9, 10, 11]);
    assert_eq!(oapp_client.combine_options(&REMOTE_EID_1, &MSG_TYPE_SEND, &extra_only), extra_only);

    let empty_extra = Bytes::new(&env);
    assert_eq!(oapp_client.combine_options(&REMOTE_EID_1, &MSG_TYPE_SEND, &empty_extra), empty_extra);

    // Set enforced options for the combine tests
    let enforced = create_valid_options(&env, &[1, 2, 3, 4]);
    let enforced_params =
        vec![&env, EnforcedOptionParam { eid: REMOTE_EID_1, msg_type: MSG_TYPE_SEND, options: Some(enforced.clone()) }];
    set_enforced_options_with_auth(&env, &owner, &oapp_client, &enforced_params);

    // combine_options: enforced present -> empty extra returns enforced
    assert_eq!(oapp_client.combine_options(&REMOTE_EID_1, &MSG_TYPE_SEND, &Bytes::new(&env)), enforced.clone());

    // combine_options: both present -> enforced + extra(without its 2-byte header)
    let extra: Bytes = create_valid_options(&env, &[4, 5, 6]);
    let combined = oapp_client.combine_options(&REMOTE_EID_1, &MSG_TYPE_SEND, &extra);
    let expected_combined = create_valid_options(&env, &[1, 2, 3, 4, 4, 5, 6]);
    assert_eq!(combined, expected_combined);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_set_enforced_options_unauthorized() {
    let TestSetup { env, owner, oapp_client, .. } = setup();

    let options = create_valid_options(&env, &[1, 2, 3, 4]);
    let enforced_params =
        vec![&env, EnforcedOptionParam { eid: REMOTE_EID_1, msg_type: MSG_TYPE_SEND, options: Some(options.clone()) }];
    oapp_client.set_enforced_options(&enforced_params, &owner);
}

#[test]
#[should_panic(expected = "Error(Contract, #1086)")] // RbacError::Unauthorized
fn test_set_enforced_options_non_owner_authorized() {
    let TestSetup { env, owner, oapp_client, .. } = setup();
    let non_owner = Address::generate(&env);
    assert!(non_owner != owner);

    let options = create_valid_options(&env, &[1, 2, 3, 4]);
    let enforced_params =
        vec![&env, EnforcedOptionParam { eid: REMOTE_EID_1, msg_type: MSG_TYPE_SEND, options: Some(options.clone()) }];

    set_enforced_options_with_auth(&env, &non_owner, &oapp_client, &enforced_params);
}

#[test]
fn test_set_enforced_options_invalid_options_returns_error() {
    let TestSetup { env, owner, oapp_client, .. } = setup();

    // wrong option type (not 3)
    let mut invalid = Bytes::from_array(&env, &(4u16).to_be_bytes());
    invalid.extend_from_slice(&[1, 2, 3]);

    let enforced_params =
        vec![&env, EnforcedOptionParam { eid: REMOTE_EID_1, msg_type: MSG_TYPE_SEND, options: Some(invalid) }];

    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &oapp_client.address,
            fn_name: "set_enforced_options",
            args: (&enforced_params, &owner).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let result = oapp_client.try_set_enforced_options(&enforced_params, &owner);
    assert_eq!(result.err().unwrap().ok().unwrap(), OAppError::InvalidOptions.into());
}

#[test]
fn test_combine_options_extra_invalid_type_returns_error_when_enforced_present() {
    let TestSetup { env, owner, oapp_client, .. } = setup();

    let enforced = create_valid_options(&env, &[1, 2, 3]);
    let params =
        vec![&env, EnforcedOptionParam { eid: REMOTE_EID_1, msg_type: MSG_TYPE_SEND, options: Some(enforced) }];
    set_enforced_options_with_auth(&env, &owner, &oapp_client, &params);

    // extra has wrong option type (not 3) but len >= 2 -> validated and should panic
    let mut extra_invalid = Bytes::from_array(&env, &(4u16).to_be_bytes());
    extra_invalid.extend_from_slice(&[9, 9, 9]);
    let result = oapp_client.try_combine_options(&REMOTE_EID_1, &MSG_TYPE_SEND, &extra_invalid);
    assert_eq!(result.err().unwrap().ok().unwrap(), OAppError::InvalidOptions.into());
}

#[test]
fn test_combine_options_extra_too_short_returns_error_when_enforced_present() {
    let TestSetup { env, owner, oapp_client, .. } = setup();

    let enforced = create_valid_options(&env, &[1, 2, 3]);
    let params =
        vec![&env, EnforcedOptionParam { eid: REMOTE_EID_1, msg_type: MSG_TYPE_SEND, options: Some(enforced) }];
    set_enforced_options_with_auth(&env, &owner, &oapp_client, &params);

    // extra is non-empty but len < 2 -> should panic
    let extra_too_short = Bytes::from_array(&env, &[1u8]);
    let result = oapp_client.try_combine_options(&REMOTE_EID_1, &MSG_TYPE_SEND, &extra_too_short);
    assert_eq!(result.err().unwrap().ok().unwrap(), OAppError::InvalidOptions.into());
}
