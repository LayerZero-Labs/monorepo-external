use crate::{self as oapp, errors::OAppError, oapp_receiver::LzReceiveInternal, oapp_sender::FeePayer};
use endpoint_v2::{MessagingFee, MessagingParams, MessagingReceipt, Origin};
use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    Address, Bytes, BytesN, Env, IntoVal,
};

// Mock Endpoint contract
#[contract]
pub struct MockEndpoint;

#[contractimpl]
impl MockEndpoint {
    pub fn __constructor(env: Env, zro_token: &Address, native_token: &Address) {
        // Store as Option<Address> so zro() can return None when unavailable.
        env.storage().instance().set(&symbol_short!("zro"), &Some(zro_token.clone()));
        env.storage().instance().set(&symbol_short!("ntk"), native_token);
    }

    pub fn set_delegate(_env: Env, _oapp: Address, _delegate: Option<Address>) {
        // do nothing in mock
    }

    pub fn quote(_env: Env, _sender: Address, params: MessagingParams) -> MessagingFee {
        MessagingFee { native_fee: 1000, zro_fee: if params.pay_in_zro { 500 } else { 0 } }
    }

    pub fn send(env: Env, _sender: Address, params: MessagingParams, _refund_address: Address) -> MessagingReceipt {
        // Record last send call for assertions
        env.storage().instance().set(&symbol_short!("snds"), &_sender);
        env.storage().instance().set(&symbol_short!("sndp"), &params);
        env.storage().instance().set(&symbol_short!("sndr"), &_refund_address);

        // Return mock receipt
        MessagingReceipt {
            guid: BytesN::from_array(&env, &[1u8; 32]),
            nonce: 1,
            fee: MessagingFee { native_fee: 1000, zro_fee: if params.pay_in_zro { 500 } else { 0 } },
        }
    }

    pub fn last_send(env: Env) -> (Address, MessagingParams, Address) {
        (
            env.storage().instance().get(&symbol_short!("snds")).unwrap(),
            env.storage().instance().get(&symbol_short!("sndp")).unwrap(),
            env.storage().instance().get(&symbol_short!("sndr")).unwrap(),
        )
    }

    pub fn zro(env: Env) -> Option<Address> {
        // Return a mock ZRO token address (or None if not set)
        env.storage().instance().get(&symbol_short!("zro")).unwrap_or(None)
    }

    pub fn native_token(env: Env) -> Address {
        env.storage().instance().get(&symbol_short!("ntk")).unwrap()
    }

    pub fn set_zro(env: Env, zro: &Option<Address>) {
        env.storage().instance().set(&symbol_short!("zro"), zro);
    }
}

#[oapp_macros::oapp]
#[common_macros::lz_contract]
pub struct DummyOAppSender;

impl LzReceiveInternal for DummyOAppSender {
    fn __lz_receive(
        _env: &Env,
        _origin: &Origin,
        _guid: &BytesN<32>,
        _message: &Bytes,
        _extra_data: &Bytes,
        _executor: &Address,
        _value: i128,
    ) {
        // Not used in sender tests
    }
}

#[contractimpl]
impl DummyOAppSender {
    pub fn __constructor(env: &Env, owner: &Address, endpoint: &Address) {
        oapp::oapp_core::init_ownable_oapp::<Self>(env, owner, endpoint, owner);
    }

    pub fn quote(env: &Env, dst_eid: u32, message: &Bytes, options: &Bytes, pay_in_zro: bool) -> MessagingFee {
        Self::__quote(env, dst_eid, message, options, pay_in_zro)
    }

    pub fn send(
        env: &Env,
        sender: &Address,
        dst_eid: u32,
        message: &Bytes,
        options: &Bytes,
        fee: &MessagingFee,
        refund_address: &Address,
    ) -> MessagingReceipt {
        sender.require_auth();
        Self::__lz_send(env, dst_eid, message, options, &FeePayer::Verified(sender.clone()), fee, refund_address)
    }

    pub fn pay_native_fee(env: &Env, fee_payer: &Address, native_fee: i128) {
        fee_payer.require_auth();
        Self::__pay_native(env, fee_payer, native_fee)
    }

    pub fn pay_zro_fee(env: &Env, fee_payer: &Address, zro_fee: i128) {
        fee_payer.require_auth();
        Self::__pay_zro(env, fee_payer, zro_fee)
    }
}

const REMOTE_EID: u32 = 100;
const UNSET_EID: u32 = 999;

struct TestSetup<'a> {
    env: Env,
    token_admin: Address,
    endpoint: Address,
    owner: Address,
    oapp_client: DummyOAppSenderClient<'a>,
    native_token: Address,
    zro_token: Address,
    native_token_client: TokenClient<'a>,
    native_token_admin_client: StellarAssetClient<'a>,
    zro_token_admin_client: StellarAssetClient<'a>,
}

fn setup<'a>() -> TestSetup<'a> {
    let env = Env::default();

    let owner = Address::generate(&env);

    let token_admin = Address::generate(&env);
    // Deploy mock tokens
    let native_token_sac = env.register_stellar_asset_contract_v2(token_admin.clone());
    let native_token = native_token_sac.address();
    let native_token_client = TokenClient::new(&env, &native_token);
    let native_token_admin_client = StellarAssetClient::new(&env, &native_token);

    let zro_token_sac = env.register_stellar_asset_contract_v2(token_admin.clone());
    let zro_token = zro_token_sac.address();
    let zro_token_admin_client = StellarAssetClient::new(&env, &zro_token);

    // Deploy mock endpoint
    let endpoint = env.register(MockEndpoint, (&zro_token, &native_token));

    // Deploy OApp
    let oapp = env.register(DummyOAppSender, (&owner, &endpoint));
    let oapp_client = DummyOAppSenderClient::new(&env, &oapp);

    TestSetup {
        env,
        endpoint,
        token_admin,
        native_token_client,
        native_token_admin_client,
        zro_token_admin_client,
        native_token,
        zro_token,
        owner,
        oapp_client,
    }
}

fn set_peer_with_auth(
    env: &Env,
    owner: &Address,
    oapp_client: &DummyOAppSenderClient<'_>,
    eid: u32,
    peer: &BytesN<32>,
) {
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

fn mint_to(
    env: &Env,
    token_admin: &Address,
    token: &Address,
    token_admin_client: &StellarAssetClient<'_>,
    to: &Address,
    amount: i128,
) {
    env.mock_auths(&[MockAuth {
        address: token_admin,
        invoke: &MockAuthInvoke {
            contract: token,
            fn_name: "mint",
            args: (to, amount).into_val(env),
            sub_invokes: &[],
        },
    }]);
    token_admin_client.mint(to, &amount);
}

fn mock_send_auth(
    env: &Env,
    sender: &Address,
    oapp_client: &DummyOAppSenderClient<'_>,
    dst_eid: u32,
    message: &Bytes,
    options: &Bytes,
    fee: &MessagingFee,
    refund_address: &Address,
    native_token: &Address,
    endpoint: &Address,
    zro_token: &Address,
) {
    let native_transfer = MockAuthInvoke {
        contract: native_token,
        fn_name: "transfer",
        args: (sender, endpoint, &fee.native_fee).into_val(env),
        sub_invokes: &[],
    };

    if fee.zro_fee > 0 {
        let zro_transfer = MockAuthInvoke {
            contract: zro_token,
            fn_name: "transfer",
            args: (sender, endpoint, &fee.zro_fee).into_val(env),
            sub_invokes: &[],
        };
        let sub_invokes = [native_transfer, zro_transfer];
        env.mock_auths(&[MockAuth {
            address: sender,
            invoke: &MockAuthInvoke {
                contract: &oapp_client.address,
                fn_name: "send",
                args: (sender, &dst_eid, message, options, fee, refund_address).into_val(env),
                sub_invokes: &sub_invokes,
            },
        }]);
    } else {
        let sub_invokes = [native_transfer];
        env.mock_auths(&[MockAuth {
            address: sender,
            invoke: &MockAuthInvoke {
                contract: &oapp_client.address,
                fn_name: "send",
                args: (sender, &dst_eid, message, options, fee, refund_address).into_val(env),
                sub_invokes: &sub_invokes,
            },
        }]);
    }
}

#[test]
fn test_quote_with_peer_set() {
    let TestSetup { env, owner, oapp_client, .. } = setup();

    // Set peer for destination
    let peer = BytesN::from_array(&env, &[1; 32]);
    set_peer_with_auth(&env, &owner, &oapp_client, REMOTE_EID, &peer);

    let message = Bytes::from_array(&env, &[1, 2, 3, 4, 5]);
    let options = Bytes::from_array(&env, &[6, 7, 8]);

    // Test quote without ZRO
    let fee = oapp_client.quote(&REMOTE_EID, &message, &options, &false);
    assert_eq!(fee.native_fee, 1000);
    assert_eq!(fee.zro_fee, 0);

    // Test quote with ZRO
    let fee_with_zro = oapp_client.quote(&REMOTE_EID, &message, &options, &true);
    assert_eq!(fee_with_zro.native_fee, 1000);
    assert_eq!(fee_with_zro.zro_fee, 500);
}

#[test]
fn test_quote_without_peer_panics() {
    let TestSetup { env, oapp_client, .. } = setup();

    let message = Bytes::from_array(&env, &[1, 2, 3]);
    let options = Bytes::from_array(&env, &[]);

    // This should panic because no peer is set for UNSET_EID
    let result = oapp_client.try_quote(&UNSET_EID, &message, &options, &false);
    assert_eq!(result.err().unwrap().ok().unwrap(), OAppError::NoPeer.into());
}

#[test]
fn test_lz_send_native_only() {
    let TestSetup {
        env,
        oapp_client,
        endpoint,
        native_token,
        zro_token,
        native_token_client,
        native_token_admin_client,
        token_admin,
        owner,
        ..
    } = setup();

    // Setup peer
    let peer = BytesN::from_array(&env, &[2; 32]);
    set_peer_with_auth(&env, &owner, &oapp_client, REMOTE_EID, &peer);

    let sender = Address::generate(&env);
    mint_to(&env, &token_admin, &native_token, &native_token_admin_client, &sender, 1000i128);

    let message = Bytes::from_array(&env, &[1, 2, 3]);
    let options = Bytes::from_array(&env, &[]);
    let refund_address = Address::generate(&env);
    let fee = MessagingFee { native_fee: 1000, zro_fee: 0 };

    mock_send_auth(
        &env,
        &sender,
        &oapp_client,
        REMOTE_EID,
        &message,
        &options,
        &fee,
        &refund_address,
        &native_token,
        &endpoint,
        &zro_token,
    );
    let receipt = oapp_client.send(&sender, &REMOTE_EID, &message, &options, &fee, &refund_address);

    assert_eq!(receipt.nonce, 1);
    assert_eq!(receipt.fee.native_fee, 1000);
    assert_eq!(receipt.fee.zro_fee, 0);

    // Assert the endpoint received the correct send params
    let endpoint_client = MockEndpointClient::new(&env, &endpoint);
    let (endpoint_sender, params, refund) = endpoint_client.last_send();
    assert_eq!(endpoint_sender, oapp_client.address);
    assert_eq!(params.dst_eid, REMOTE_EID);
    assert_eq!(params.receiver, peer);
    assert_eq!(params.message, message);
    assert_eq!(params.options, options);
    assert_eq!(params.pay_in_zro, false);
    assert_eq!(refund, refund_address);

    assert_eq!(native_token_client.balance(&sender), 0);
    assert_eq!(native_token_client.balance(&endpoint), 1000);
    assert_eq!(TokenClient::new(&env, &zro_token).balance(&endpoint), 0);
}

#[test]
fn test_lz_send_with_zro() {
    let TestSetup {
        env,
        oapp_client,
        endpoint,
        native_token,
        zro_token,
        native_token_client,
        native_token_admin_client,
        zro_token_admin_client,
        token_admin,
        owner,
        ..
    } = setup();

    // Setup peer
    let peer = BytesN::from_array(&env, &[3; 32]);
    set_peer_with_auth(&env, &owner, &oapp_client, REMOTE_EID, &peer);

    let sender = Address::generate(&env);
    let fee = MessagingFee { native_fee: 1000, zro_fee: 500 };
    mint_to(&env, &token_admin, &native_token, &native_token_admin_client, &sender, fee.native_fee);
    mint_to(&env, &token_admin, &zro_token, &zro_token_admin_client, &sender, fee.zro_fee);

    let message = Bytes::from_array(&env, &[4, 5, 6]);
    let options = Bytes::from_array(&env, &[7]);
    let refund_address = Address::generate(&env);

    mock_send_auth(
        &env,
        &sender,
        &oapp_client,
        REMOTE_EID,
        &message,
        &options,
        &fee,
        &refund_address,
        &native_token,
        &endpoint,
        &zro_token,
    );
    let receipt = oapp_client.send(&sender, &REMOTE_EID, &message, &options, &fee, &refund_address);

    assert_eq!(receipt.nonce, 1);
    assert_eq!(receipt.fee.native_fee, 1000);
    assert_eq!(receipt.fee.zro_fee, 500);

    // Assert the endpoint received the correct send params
    let endpoint_client = MockEndpointClient::new(&env, &endpoint);
    let (endpoint_sender, params, refund) = endpoint_client.last_send();
    assert_eq!(endpoint_sender, oapp_client.address);
    assert_eq!(params.dst_eid, REMOTE_EID);
    assert_eq!(params.receiver, peer);
    assert_eq!(params.message, message);
    assert_eq!(params.options, options);
    assert_eq!(params.pay_in_zro, true);
    assert_eq!(refund, refund_address);

    assert_eq!(native_token_client.balance(&sender), 0);
    assert_eq!(native_token_client.balance(&endpoint), 1000);

    let zro_token_client = TokenClient::new(&env, &zro_token);
    assert_eq!(zro_token_client.balance(&sender), 0);
    assert_eq!(zro_token_client.balance(&endpoint), 500);
}

#[test]
fn test_pay_native() {
    let TestSetup { env, oapp_client, endpoint, native_token, native_token_admin_client, token_admin, .. } = setup();

    let payer = Address::generate(&env);
    let payment_amount = 2000i128;

    // Fund the payer
    mint_to(&env, &token_admin, &native_token, &native_token_admin_client, &payer, payment_amount);

    // Make payment
    env.mock_auths(&[MockAuth {
        address: &payer,
        invoke: &MockAuthInvoke {
            contract: &oapp_client.address,
            fn_name: "pay_native_fee",
            args: (&payer, &payment_amount).into_val(&env),
            sub_invokes: &[MockAuthInvoke {
                contract: &native_token,
                fn_name: "transfer",
                args: (&payer, &endpoint, &payment_amount).into_val(&env),
                sub_invokes: &[],
            }],
        },
    }]);
    oapp_client.pay_native_fee(&payer, &payment_amount);

    // Verify balances
    assert_eq!(native_token_admin_client.balance(&payer), 0);
    assert_eq!(native_token_admin_client.balance(&endpoint), payment_amount);
}

#[test]
#[should_panic(expected = "balance is not sufficient to spend")]
fn test_pay_native_insufficient_balance() {
    let TestSetup { env, oapp_client, endpoint, native_token, native_token_admin_client, token_admin, .. } = setup();

    let balance = 500i128;
    let payment_amount = 1000i128;

    let payer = Address::generate(&env);

    // Fund with less than required
    mint_to(&env, &token_admin, &native_token, &native_token_admin_client, &payer, balance);

    // This should panic due to insufficient balance
    env.mock_auths(&[MockAuth {
        address: &payer,
        invoke: &MockAuthInvoke {
            contract: &oapp_client.address,
            fn_name: "pay_native_fee",
            args: (&payer, &payment_amount).into_val(&env),
            sub_invokes: &[MockAuthInvoke {
                contract: &native_token,
                fn_name: "transfer",
                args: (&payer, &endpoint, &payment_amount).into_val(&env),
                sub_invokes: &[],
            }],
        },
    }]);
    oapp_client.pay_native_fee(&payer, &payment_amount);
}

#[test]
fn test_pay_zro_success() {
    let TestSetup { env, oapp_client, endpoint, zro_token, zro_token_admin_client, token_admin, .. } = setup();

    let payer = Address::generate(&env);
    let payment_amount = 500i128;
    mint_to(&env, &token_admin, &zro_token, &zro_token_admin_client, &payer, payment_amount);

    env.mock_auths(&[MockAuth {
        address: &payer,
        invoke: &MockAuthInvoke {
            contract: &oapp_client.address,
            fn_name: "pay_zro_fee",
            args: (&payer, &payment_amount).into_val(&env),
            sub_invokes: &[MockAuthInvoke {
                contract: &zro_token,
                fn_name: "transfer",
                args: (&payer, &endpoint, &payment_amount).into_val(&env),
                sub_invokes: &[],
            }],
        },
    }]);
    oapp_client.pay_zro_fee(&payer, &payment_amount);

    assert_eq!(zro_token_admin_client.balance(&payer), 0);
    assert_eq!(zro_token_admin_client.balance(&endpoint), payment_amount);
}

#[test]
#[should_panic(expected = "balance is not sufficient to spend")]
fn test_pay_zro_insufficient_balance() {
    let TestSetup { env, oapp_client, endpoint, zro_token, zro_token_admin_client, token_admin, .. } = setup();

    let payer = Address::generate(&env);
    let balance = 100i128;
    let payment_amount = 500i128;

    // Fund with less than required
    mint_to(&env, &token_admin, &zro_token, &zro_token_admin_client, &payer, balance);

    env.mock_auths(&[MockAuth {
        address: &payer,
        invoke: &MockAuthInvoke {
            contract: &oapp_client.address,
            fn_name: "pay_zro_fee",
            args: (&payer, &payment_amount).into_val(&env),
            sub_invokes: &[MockAuthInvoke {
                contract: &zro_token,
                fn_name: "transfer",
                args: (&payer, &endpoint, &payment_amount).into_val(&env),
                sub_invokes: &[],
            }],
        },
    }]);
    oapp_client.pay_zro_fee(&payer, &payment_amount);
}

#[test]
fn test_pay_zro_unavailable_returns_error() {
    let TestSetup { env, oapp_client, endpoint, zro_token, .. } = setup();

    let endpoint_client = MockEndpointClient::new(&env, &endpoint);
    endpoint_client.set_zro(&None);

    let payer = Address::generate(&env);
    let payment_amount = 500i128;

    env.mock_auths(&[MockAuth {
        address: &payer,
        invoke: &MockAuthInvoke {
            contract: &oapp_client.address,
            fn_name: "pay_zro_fee",
            args: (&payer, &payment_amount).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let result = oapp_client.try_pay_zro_fee(&payer, &payment_amount);
    assert_eq!(result.err().unwrap().ok().unwrap(), OAppError::ZroTokenUnavailable.into());

    // Ensure we did not transfer any ZRO accidentally
    let token_client = TokenClient::new(&env, &zro_token);
    assert_eq!(token_client.balance(&payer), 0);
}
