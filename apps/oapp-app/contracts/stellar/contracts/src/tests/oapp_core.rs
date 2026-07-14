use crate::{self as oapp, oapp_core::PeerSet, oapp_receiver::LzReceiveInternal};
use endpoint_v2::Origin;
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, Bytes, BytesN, Env, IntoVal,
};
use utils::testing_utils::assert_eq_event;

#[contract]
pub struct DummyEndpoint;

#[derive(Clone)]
#[contracttype]
enum DummyEndpointDataKey {
    Delegate(Address),
}

#[contractimpl]
impl DummyEndpoint {
    pub fn set_delegate(env: Env, oapp: &Address, delegate: &Option<Address>) {
        let key = DummyEndpointDataKey::Delegate(oapp.clone());
        match delegate {
            Some(d) => env.storage().persistent().set(&key, d),
            None => env.storage().persistent().remove(&key),
        }
    }

    pub fn get_delegate(env: Env, oapp: Address) -> Option<Address> {
        env.storage().persistent().get(&DummyEndpointDataKey::Delegate(oapp))
    }
}

#[oapp_macros::oapp]
#[common_macros::lz_contract]
pub struct DummyOApp;

impl LzReceiveInternal for DummyOApp {
    fn __lz_receive(
        _env: &Env,
        _origin: &Origin,
        _guid: &BytesN<32>,
        _message: &Bytes,
        _extra_data: &Bytes,
        _executor: &Address,
        _value: i128,
    ) {
        // Not used in core tests
    }
}

#[contractimpl]
impl DummyOApp {
    pub fn __constructor(env: &Env, owner: &Address, endpoint: &Address) {
        oapp::oapp_core::init_ownable_oapp::<Self>(env, owner, endpoint, owner);
    }
}

const REMOTE_EID: u32 = 100;
const UNSET_EID: u32 = 999;

struct TestSetup<'a> {
    env: Env,
    owner: Address,
    endpoint: Address,
    oapp_client: DummyOAppClient<'a>,
}

fn setup<'a>() -> TestSetup<'a> {
    let env = Env::default();

    let owner = Address::generate(&env);
    soroban_sdk::log!(&env, "owner: {}", owner);
    let endpoint = env.register(DummyEndpoint, ());
    soroban_sdk::log!(&env, "endpoint: {}", endpoint);
    let oapp = env.register(DummyOApp, (&owner, &endpoint));
    soroban_sdk::log!(&env, "oapp: {}", oapp);
    let oapp_client = DummyOAppClient::new(&env, &oapp);

    TestSetup { env, owner, endpoint, oapp_client }
}

fn set_peer_with_auth(
    env: &Env,
    signer: &Address,
    oapp_client: &DummyOAppClient<'_>,
    eid: u32,
    peer: &Option<BytesN<32>>,
) {
    env.mock_auths(&[MockAuth {
        address: signer,
        invoke: &MockAuthInvoke {
            contract: &oapp_client.address,
            fn_name: "set_peer",
            args: (&eid, peer, signer).into_val(env),
            sub_invokes: &[],
        },
    }]);
    oapp_client.set_peer(&eid, peer, signer);
}

fn set_delegate_with_auth(env: &Env, signer: &Address, oapp_client: &DummyOAppClient<'_>, delegate: &Option<Address>) {
    env.mock_auths(&[MockAuth {
        address: signer,
        invoke: &MockAuthInvoke {
            contract: &oapp_client.address,
            fn_name: "set_delegate",
            args: (delegate, signer).into_val(env),
            sub_invokes: &[],
        },
    }]);
    oapp_client.set_delegate(delegate, signer);
}

#[test]
fn test_constructor_initializes_owner_and_endpoint_and_delegate() {
    let TestSetup { env, owner, endpoint, oapp_client } = setup();

    // owner initialized via oapp_initialize -> init_owner
    assert_eq!(Some(owner.clone()), oapp_client.owner());

    // endpoint stored via OAppCoreStorage::set_endpoint
    assert_eq!(endpoint, oapp_client.endpoint());

    // delegate set via oapp_initialize(..., owner) -> endpoint.set_delegate(..., Some(owner))
    let endpoint_client = DummyEndpointClient::new(&env, &endpoint);
    assert_eq!(Some(owner), endpoint_client.get_delegate(&oapp_client.address));
}

#[test]
fn test_oapp_version_defaults_to_zero() {
    let TestSetup { oapp_client, .. } = setup();
    assert_eq!((1, 1), oapp_client.oapp_version());
}

#[test]
fn test_peer_lifecycle_set_get_update_remove_and_events() {
    let TestSetup { env, owner, oapp_client, .. } = setup();

    // Unset cases
    assert_eq!(None, oapp_client.peer(&UNSET_EID));
    assert_eq!(None, oapp_client.peer(&REMOTE_EID));

    // Set peer v1
    let peer_v1: BytesN<32> = BytesN::from_array(&env, &[33; 32]);
    let peer_v1_option = Some(peer_v1.clone());
    set_peer_with_auth(&env, &owner, &oapp_client, REMOTE_EID, &peer_v1_option);

    assert_eq_event(&env, &oapp_client.address, PeerSet { eid: REMOTE_EID, peer: Some(peer_v1.clone()) });
    assert_eq!(Some(peer_v1), oapp_client.peer(&REMOTE_EID));
    assert_eq!(None, oapp_client.peer(&UNSET_EID));

    // Update to peer v2
    let peer_v2: BytesN<32> = BytesN::from_array(&env, &[2; 32]);
    let peer_v2_option = Some(peer_v2.clone());
    set_peer_with_auth(&env, &owner, &oapp_client, REMOTE_EID, &peer_v2_option);

    assert_eq_event(&env, &oapp_client.address, PeerSet { eid: REMOTE_EID, peer: Some(peer_v2.clone()) });
    assert_eq!(Some(peer_v2), oapp_client.peer(&REMOTE_EID));

    // Remove peer
    let none_peer: Option<BytesN<32>> = None;
    set_peer_with_auth(&env, &owner, &oapp_client, REMOTE_EID, &none_peer);
    assert_eq_event(&env, &oapp_client.address, PeerSet { eid: REMOTE_EID, peer: None });
    assert_eq!(None, oapp_client.peer(&REMOTE_EID));
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_set_peer_unauthorized() {
    let TestSetup { env, owner, oapp_client, .. } = setup();

    let test_peer: BytesN<32> = BytesN::from_array(&env, &[33; 32]);
    oapp_client.set_peer(&REMOTE_EID, &Some(test_peer), &owner);
}

#[test]
#[should_panic(expected = "Error(Contract, #1086)")] // RbacError::Unauthorized
fn test_set_peer_non_owner_authorized() {
    let TestSetup { env, owner, oapp_client, .. } = setup();
    let non_owner = Address::generate(&env);
    assert!(non_owner != owner);

    let peer: BytesN<32> = BytesN::from_array(&env, &[33; 32]);
    let peer_option = Some(peer);
    set_peer_with_auth(&env, &non_owner, &oapp_client, REMOTE_EID, &peer_option);
}

#[test]
fn test_set_delegate_updates_and_clears_endpoint_delegate() {
    let TestSetup { env, owner, endpoint, oapp_client } = setup();

    let delegate = Address::generate(&env);
    let delegate_option = Some(delegate.clone());
    set_delegate_with_auth(&env, &owner, &oapp_client, &delegate_option);

    let endpoint_client = DummyEndpointClient::new(&env, &endpoint);
    assert_eq!(Some(delegate), endpoint_client.get_delegate(&oapp_client.address));

    // Clear delegate
    let none_delegate: Option<Address> = None;
    set_delegate_with_auth(&env, &owner, &oapp_client, &none_delegate);
    assert_eq!(None, endpoint_client.get_delegate(&oapp_client.address));
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_set_delegate_unauthorized() {
    let TestSetup { env, owner, oapp_client, .. } = setup();

    let delegate = Address::generate(&env);
    oapp_client.set_delegate(&Some(delegate), &owner);
}

#[test]
#[should_panic(expected = "Error(Contract, #1086)")] // RbacError::Unauthorized
fn test_set_delegate_non_owner_authorized() {
    let TestSetup { env, owner, oapp_client, .. } = setup();
    let non_owner = Address::generate(&env);
    assert!(non_owner != owner);

    let delegate = Address::generate(&env);
    let delegate_option = Some(delegate);
    set_delegate_with_auth(&env, &non_owner, &oapp_client, &delegate_option);
}
