use common_macros::contract_impl;
use soroban_sdk::{
    contract,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token, Address, Env, IntoVal, Val, Vec,
};

use crate::treasury::{Treasury, TreasuryClient};

// === Test Constants ===

pub const BPS_DENOMINATOR: u32 = 10000;

// === Dummy Contract for creating valid addresses ===

/// A minimal dummy contract used to create valid contract addresses in tests.
/// This is needed because `Address::generate()` creates addresses that don't
/// pass the `.exists()` check in Soroban.
#[contract]
pub struct DummyContract;

#[contract_impl]
impl DummyContract {
    pub fn __constructor(_env: &Env) {}
}

/// Test setup struct following the pattern from endpoint-v2 and uln-302
pub struct TestSetup<'a> {
    pub env: Env,
    pub owner: Address,
    pub treasury: TreasuryClient<'a>,
}

/// Creates a new test setup with a deployed treasury contract
pub fn setup<'a>() -> TestSetup<'a> {
    let env = Env::default();
    let owner = Address::generate(&env);

    let treasury = env.register(Treasury, (&owner,));
    let treasury_client = TreasuryClient::new(&env, &treasury);

    TestSetup { env, owner, treasury: treasury_client }
}

impl<'a> TestSetup<'a> {
    /// Helper to mock owner auth for treasury operations
    pub fn mock_owner_auth<T: IntoVal<Env, Vec<Val>>>(&self, fn_name: &str, args: T) {
        self.env.mock_auths(&[MockAuth {
            address: &self.owner,
            invoke: &MockAuthInvoke {
                contract: &self.treasury.address,
                fn_name,
                args: args.into_val(&self.env),
                sub_invokes: &[],
            },
        }]);
    }

    /// Helper to mock auth for any address (for testing unauthorized access)
    pub fn mock_auth<T: IntoVal<Env, Vec<Val>>>(&self, address: &Address, fn_name: &str, args: T) {
        self.env.mock_auths(&[MockAuth {
            address,
            invoke: &MockAuthInvoke {
                contract: &self.treasury.address,
                fn_name,
                args: args.into_val(&self.env),
                sub_invokes: &[],
            },
        }]);
    }

    /// Creates a valid contract address by registering a dummy contract.
    /// Use this instead of `Address::generate()` when the address needs to pass `.exists()` check.
    pub fn create_contract_address(&self) -> Address {
        self.env.register(DummyContract, ())
    }

    /// Configure treasury with native fee basis points and enable fees
    pub fn configure_treasury(&self, native_fee_bp: u32) {
        self.mock_owner_auth("set_native_fee_bp", (&native_fee_bp,));
        self.treasury.set_native_fee_bp(&native_fee_bp);

        self.mock_owner_auth("set_fee_enabled", (&true,));
        self.treasury.set_fee_enabled(&true);
    }

    /// Deploys a test token contract and returns its address
    pub fn deploy_test_token(&self) -> Address {
        self.env.register_stellar_asset_contract_v2(self.owner.clone()).address()
    }

    /// Mints tokens to a specified address
    pub fn mint_tokens(&self, token: &Address, to: &Address, amount: i128) {
        let token_admin = token::StellarAssetClient::new(&self.env, token);
        // Mock authorization for the mint operation
        self.env.mock_auths(&[MockAuth {
            address: &self.owner,
            invoke: &MockAuthInvoke {
                contract: token,
                fn_name: "mint",
                args: (to, &amount).into_val(&self.env),
                sub_invokes: &[],
            },
        }]);
        token_admin.mint(to, &amount);
    }

    /// Gets the token balance of an address
    pub fn get_token_balance(&self, token: &Address, address: &Address) -> i128 {
        let token_client = token::TokenClient::new(&self.env, token);
        token_client.balance(address)
    }
}
