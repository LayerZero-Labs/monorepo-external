extern crate std;

use crate::oft_types::lock_unlock;
use endpoint_v2::Origin;
use oapp::oapp_receiver::{LzReceiveInternal, OAppReceiver};
use oft_core::{OFTCore, OFTInternal, OFTReceipt};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Bytes, BytesN, Env,
};

// ============================================================================
// Mock Contracts
// ============================================================================

#[contract]
struct DummyEndpoint;

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
}

// ============================================================================
// LockUnlock OFT Harness Contract
// ============================================================================

#[oapp_macros::oapp(custom = [receiver])]
#[common_macros::lz_contract]
pub struct LockUnlockHarnessOFT;

#[contractimpl]
impl LockUnlockHarnessOFT {
    pub fn __constructor(
        env: &Env,
        token: &Address,
        owner: &Address,
        endpoint: &Address,
        delegate: &Address,
        shared_decimals: u32,
    ) {
        Self::__initialize_oft(env, token, shared_decimals, owner, endpoint, delegate);
    }

    pub fn debit(env: Env, sender: Address, amount_ld: i128, min_amount_ld: i128, dst_eid: u32) -> OFTReceipt {
        let (amount_sent_ld, amount_received_ld) =
            <Self as OFTInternal>::__debit(&env, &sender, amount_ld, min_amount_ld, dst_eid);
        OFTReceipt { amount_sent_ld, amount_received_ld }
    }

    pub fn credit(env: Env, to: Address, amount_ld: i128, src_eid: u32) -> i128 {
        <Self as OFTInternal>::__credit(&env, &to, amount_ld, src_eid)
    }
}

#[contractimpl(contracttrait)]
impl OFTCore for LockUnlockHarnessOFT {}

impl LzReceiveInternal for LockUnlockHarnessOFT {
    fn __lz_receive(
        env: &Env,
        origin: &Origin,
        guid: &BytesN<32>,
        message: &Bytes,
        extra_data: &Bytes,
        executor: &Address,
        value: i128,
    ) {
        <Self as OFTInternal>::__receive(env, origin, guid, message, extra_data, executor, value)
    }
}

#[contractimpl(contracttrait)]
impl OAppReceiver for LockUnlockHarnessOFT {}

impl OFTInternal for LockUnlockHarnessOFT {
    fn __debit(env: &Env, sender: &Address, amount_ld: i128, min_amount_ld: i128, dst_eid: u32) -> (i128, i128) {
        let target = Self::token(env);
        lock_unlock::debit::<Self>(env, &target, sender, amount_ld, min_amount_ld, dst_eid)
    }

    fn __credit(env: &Env, to: &Address, amount_ld: i128, src_eid: u32) -> i128 {
        let target = Self::token(env);
        lock_unlock::credit::<Self>(env, &target, to, amount_ld, src_eid)
    }
}

// ============================================================================
// Test Setup
// ============================================================================

struct TestSetup {
    env: Env,
    client: LockUnlockHarnessOFTClient<'static>,
    oft_address: Address,
    token: Address,
}

fn setup() -> TestSetup {
    let env = Env::default();
    // Enable mock_all_auths_allowing_non_root_auth for all tests to bypass authorization checks
    // including sub-contract invocations like token transfers
    env.mock_all_auths_allowing_non_root_auth();

    let token_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = sac.address();
    let endpoint = env.register(DummyEndpoint, ());

    let owner = Address::generate(&env);
    let delegate = owner.clone();
    let shared_decimals: u32 = 6;

    let oft_address = env.register(LockUnlockHarnessOFT, (&token, &owner, &endpoint, &delegate, &shared_decimals));
    let client = LockUnlockHarnessOFTClient::new(&env, &oft_address);

    TestSetup { env, client, oft_address, token }
}

// ============================================================================
// Tests
// ============================================================================

#[test]
fn test_debit_transfers_to_contract() {
    let TestSetup { env, client, oft_address, token, .. } = setup();

    let sender = Address::generate(&env);

    // Auth is automatically mocked by mock_all_auths_allowing_non_root_auth
    StellarAssetClient::new(&env, &token).mint(&sender, &1_000_000i128);

    let token_client = TokenClient::new(&env, &token);
    let sender_before = token_client.balance(&sender);
    let contract_before = token_client.balance(&oft_address);

    // With shared_decimals=6 and typical SAC decimals=7, conversion_rate=10 => 105 -> 100.
    // debit transfers from sender to OFT contract
    let amount_ld = 105i128;

    let receipt = client.debit(&sender, &amount_ld, &0i128, &999u32);
    assert_eq!(receipt.amount_sent_ld, receipt.amount_received_ld);

    // LockUnlock transfers `amount_received_ld` from sender -> contract.
    assert_eq!(token_client.balance(&sender), sender_before - receipt.amount_received_ld);
    assert_eq!(token_client.balance(&oft_address), contract_before + receipt.amount_received_ld);
}

#[test]
fn test_credit_transfers_from_contract() {
    let TestSetup { env, client, oft_address, token, .. } = setup();

    let recipient = Address::generate(&env);

    // Auth is automatically mocked by mock_all_auths_allowing_non_root_auth
    StellarAssetClient::new(&env, &token).mint(&oft_address, &1_000_000i128);

    let token_client = TokenClient::new(&env, &token);
    let contract_before = token_client.balance(&oft_address);
    let recipient_before = token_client.balance(&recipient);

    // credit transfers from OFT contract to recipient
    let amount = 123i128;

    let credited = client.credit(&recipient, &amount, &1u32);
    assert_eq!(credited, amount);

    // LockUnlock transfers `amount` from contract -> recipient.
    assert_eq!(token_client.balance(&oft_address), contract_before - amount);
    assert_eq!(token_client.balance(&recipient), recipient_before + amount);
}
