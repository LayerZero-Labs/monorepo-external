extern crate std;

use crate::extensions::oft_fee::FEE_CONFIG_MANAGER_ROLE;
use crate::extensions::oft_fee::{OFTFee, OFTFeeError, OFTFeeInternal};
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    Address, Env, IntoVal, Symbol,
};
use utils::auth::Auth;
use utils::rbac::{grant_role_no_auth, RoleBasedAccessControl};

// ============================================================================
// Test Contract
// ============================================================================

#[contract]
struct FeeTestContract;

impl Auth for FeeTestContract {
    fn authorizer(env: &Env) -> Option<Address> {
        Some(env.current_contract_address())
    }
}

impl OFTFeeInternal for FeeTestContract {}

#[contractimpl(contracttrait)]
impl OFTFee for FeeTestContract {}

#[contractimpl(contracttrait)]
impl RoleBasedAccessControl for FeeTestContract {}

#[contractimpl]
impl FeeTestContract {
    /// Test-only: grants FEE_CONFIG_MANAGER_ROLE to the contract.
    pub fn init_roles(env: Env) {
        let contract_id = env.current_contract_address();
        grant_role_no_auth(&env, &contract_id, &Symbol::new(&env, FEE_CONFIG_MANAGER_ROLE), &contract_id);
    }

    pub fn fee_view(env: Env, dst_eid: u32, amount_ld: i128) -> i128 {
        <Self as OFTFeeInternal>::__fee_view(&env, dst_eid, amount_ld)
    }

    pub fn charge_fee(env: Env, token: Address, from: Address, fee_amount: i128) {
        <Self as OFTFeeInternal>::__charge_fee(&env, &token, &from, fee_amount)
    }
}

// ============================================================================
// Test Setup
// ============================================================================

struct TestSetup {
    env: Env,
    client: FeeTestContractClient<'static>,
    contract_id: Address,
    token: Address,
    from: Address,
    fee_deposit: Address,
}

fn setup() -> TestSetup {
    let env = Env::default();
    // Enable mock_all_auths_allowing_non_root_auth for all tests to bypass authorization checks
    // including sub-contract invocations like token transfers
    env.mock_all_auths_allowing_non_root_auth();

    let contract_id = env.register(FeeTestContract, ());
    let client = FeeTestContractClient::new(&env, &contract_id);
    client.init_roles();

    let token_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = sac.address();

    let from = Address::generate(&env);
    let fee_deposit = Address::generate(&env);

    // Mint to `from` - auth is mocked globally
    StellarAssetClient::new(&env, &token).mint(&from, &1_000_000i128);

    TestSetup { env, client, contract_id, token, from, fee_deposit }
}

// ============================================================================
// Fee View Tests
// ============================================================================

#[test]
fn test_fee_view_zero_fee_returns_zero() {
    let TestSetup { client, .. } = setup();

    let fee = client.fee_view(&1u32, &1_000_000i128);
    assert_eq!(fee, 0);
}

#[test]
fn test_fee_deposit_address_returns_none_when_unset() {
    let TestSetup { client, .. } = setup();

    assert_eq!(client.fee_deposit_address(), None);
}

#[test]
fn test_fee_view_nonzero_fee_errors_when_deposit_address_unset() {
    let TestSetup { client, contract_id, .. } = setup();

    client.set_default_fee_bps(&Some(100u32), &contract_id);

    let res = client.try_fee_view(&7u32, &1_000_000i128);
    assert_eq!(res.err().unwrap().ok().unwrap(), OFTFeeError::InvalidFeeDepositAddress.into());
}

// ============================================================================
// Set Default Fee BPS Tests
// ============================================================================

#[test]
fn test_set_default_fee_bps_rejects_invalid_value() {
    let TestSetup { client, contract_id, .. } = setup();

    // Zero is not a valid default fee (use None to remove instead)
    let res = client.try_set_default_fee_bps(&Some(0u32), &contract_id);
    assert_eq!(res.err().unwrap().ok().unwrap(), OFTFeeError::InvalidFeeBps.into());

    // Exceeds maximum
    let res = client.try_set_default_fee_bps(&Some(10_001u32), &contract_id);
    assert_eq!(res.err().unwrap().ok().unwrap(), OFTFeeError::InvalidFeeBps.into());
}

#[test]
fn test_set_default_fee_bps_rejects_same_value() {
    let TestSetup { client, contract_id, .. } = setup();

    // None when already None (not set)
    let none: Option<u32> = None;
    let res = client.try_set_default_fee_bps(&none, &contract_id);
    assert_eq!(res.err().unwrap().ok().unwrap(), OFTFeeError::SameValue.into());

    // Same value when already set
    client.set_default_fee_bps(&Some(123u32), &contract_id);
    let res2 = client.try_set_default_fee_bps(&Some(123u32), &contract_id);
    assert_eq!(res2.err().unwrap().ok().unwrap(), OFTFeeError::SameValue.into());
}

// ============================================================================
// Set Fee BPS Tests
// ============================================================================

#[test]
fn test_set_fee_bps_rejects_invalid_and_same_value() {
    let TestSetup { client, contract_id, .. } = setup();
    let dst_eid = 101u32;

    let res = client.try_set_fee_bps(&dst_eid, &None, &contract_id);
    assert_eq!(res.err().unwrap().ok().unwrap(), OFTFeeError::SameValue.into());

    let res2 = client.try_set_fee_bps(&dst_eid, &Some(10_001u32), &contract_id);
    assert_eq!(res2.err().unwrap().ok().unwrap(), OFTFeeError::InvalidFeeBps.into());
}

#[test]
fn test_set_fee_bps_set_and_remove() {
    let TestSetup { client, contract_id, .. } = setup();
    let dst_eid = 101u32;

    client.set_fee_bps(&dst_eid, &Some(200u32), &contract_id);
    assert_eq!(client.fee_bps(&dst_eid), Some(200u32));
    assert_eq!(client.effective_fee_bps(&dst_eid), 200u32);

    client.set_default_fee_bps(&Some(111u32), &contract_id);
    client.set_fee_bps(&dst_eid, &None, &contract_id);
    assert_eq!(client.fee_bps(&dst_eid), None);
    assert_eq!(client.effective_fee_bps(&dst_eid), 111u32);
}

// ============================================================================
// Charge Fee Tests
// ============================================================================

#[test]
fn test_charge_fee_errors_without_deposit_address() {
    let TestSetup { env, client, contract_id, token, from, .. } = setup();

    // Mock auth for token transfer (will fail before transfer due to missing deposit address)
    env.mock_auths(&[MockAuth {
        address: &from,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "charge_fee",
            args: (&token, &from, &1i128).into_val(&env),
            sub_invokes: &[MockAuthInvoke {
                contract: &token,
                fn_name: "transfer",
                args: (&from, &Address::generate(&env), &1i128).into_val(&env),
                sub_invokes: &[],
            }],
        },
    }]);

    let res = client.try_charge_fee(&token, &from, &1i128);
    assert_eq!(res.err().unwrap().ok().unwrap(), OFTFeeError::InvalidFeeDepositAddress.into());
}

#[test]
fn test_set_fee_deposit_address_same_value() {
    let TestSetup { client, contract_id, fee_deposit, .. } = setup();

    let fee_deposit_opt = Some(fee_deposit);
    client.set_fee_deposit_address(&fee_deposit_opt, &contract_id);
    let res = client.try_set_fee_deposit_address(&fee_deposit_opt, &contract_id);
    assert_eq!(res.err().unwrap().ok().unwrap(), OFTFeeError::SameValue.into());
}

#[test]
fn test_charge_fee_zero_amount_no_transfer() {
    let TestSetup { env, client, contract_id, token, from, fee_deposit, .. } = setup();

    client.set_fee_deposit_address(&Some(fee_deposit.clone()), &contract_id);

    let token_client = TokenClient::new(&env, &token);
    let from_before = token_client.balance(&from);
    let dep_before = token_client.balance(&fee_deposit);

    // fee_amount == 0 => no transfer
    client.charge_fee(&token, &from, &0i128);

    assert_eq!(token_client.balance(&from), from_before);
    assert_eq!(token_client.balance(&fee_deposit), dep_before);
}

#[test]
fn test_charge_fee_transfers() {
    let TestSetup { env, client, contract_id, token, from, fee_deposit, .. } = setup();

    client.set_fee_deposit_address(&Some(fee_deposit.clone()), &contract_id);

    let token_client = TokenClient::new(&env, &token);
    let from_before = token_client.balance(&from);
    let dep_before = token_client.balance(&fee_deposit);

    client.charge_fee(&token, &from, &123i128);

    assert_eq!(token_client.balance(&from), from_before - 123);
    assert_eq!(token_client.balance(&fee_deposit), dep_before + 123);
}

#[test]
fn test_fee_view_computes_correct_fee() {
    let TestSetup { client, contract_id, fee_deposit, .. } = setup();

    client.set_fee_deposit_address(&Some(fee_deposit), &contract_id);
    client.set_default_fee_bps(&Some(100u32), &contract_id); // 1%

    let fee = client.fee_view(&999u32, &10_000i128);
    assert_eq!(fee, 100); // 1% of 10,000
}
