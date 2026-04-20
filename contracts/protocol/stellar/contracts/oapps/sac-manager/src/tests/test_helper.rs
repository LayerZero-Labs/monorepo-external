//! Test helper utilities for SAC manager tests.
//!
//! Provides authentication mocking helpers and common setup utilities.

extern crate std;

use crate::{SACManager, SACManagerClient};
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke, StellarAssetContract},
    token::StellarAssetClient,
    Address, Env, IntoVal, Symbol, Val,
};

// =========================================================================
// TestSetup Builder
// =========================================================================

/// Builder for creating test setups with chainable configuration.
///
/// # Example
/// ```ignore
/// let setup = TestSetup::new()
///     .with_manager_as_sac_admin()
///     .build();
/// ```
pub struct TestSetupBuilder {
    manager_as_sac_admin: bool,
}

impl TestSetupBuilder {
    fn new() -> Self {
        Self { manager_as_sac_admin: false }
    }

    /// Set the SACManager as SAC admin during setup.
    pub fn with_manager_as_sac_admin(mut self) -> Self {
        self.manager_as_sac_admin = true;
        self
    }

    /// Build the TestSetup with the configured options.
    pub fn build<'a>(self) -> TestSetup<'a> {
        let env = Env::default();

        let owner = Address::generate(&env);
        let oft = Address::generate(&env);
        let sac_contract = env.register_stellar_asset_contract_v2(owner.clone());
        let sac = sac_contract.address();

        let sac_manager = env.register(SACManager, (&sac, &owner));
        let sac_manager_client = SACManagerClient::new(&env, &sac_manager);
        let sac_client = StellarAssetClient::new(&env, &sac);

        // Grant all roles to owner (owner is the authorizer so can grant any role)
        for role_str in ["ADMIN_MANAGER_ROLE", "MINTER_ROLE", "BLACKLISTER_ROLE", "CLAWBACK_ROLE"] {
            let role = Symbol::new(&env, role_str);
            mock_auth(&env, &sac_manager, &owner, "grant_role", (owner.clone(), role.clone(), owner.clone()));
            sac_manager_client.grant_role(&owner, &role, &owner);
        }

        // Grant MINTER_ROLE to oft so it can call mint in tests
        let minter_role = Symbol::new(&env, "MINTER_ROLE");
        mock_auth(&env, &sac_manager, &owner, "grant_role", (oft.clone(), minter_role.clone(), owner.clone()));
        sac_manager_client.grant_role(&oft, &minter_role, &owner);

        if self.manager_as_sac_admin {
            env.mock_auths(&[MockAuth {
                address: &owner,
                invoke: &MockAuthInvoke {
                    contract: &sac,
                    fn_name: "set_admin",
                    args: (&sac_manager,).into_val(&env),
                    sub_invokes: &[],
                },
            }]);
            sac_client.set_admin(&sac_manager);
        }

        // Clear mock auths so test starts with clean auth state
        env.mock_auths(&[]);

        TestSetup { env, owner, minter: oft, sac, sac_contract, sac_manager, sac_manager_client, sac_client }
    }
}

// =========================================================================
// TestSetup
// =========================================================================

/// Common test setup that creates a SAC and SACManager.
pub struct TestSetup<'a> {
    pub env: Env,
    pub owner: Address,
    /// Address that has MINTER_ROLE in default setup (used as operator for mint in tests).
    pub minter: Address,
    pub sac: Address,
    pub sac_contract: StellarAssetContract,
    pub sac_manager: Address,
    pub sac_manager_client: SACManagerClient<'a>,
    pub sac_client: StellarAssetClient<'a>,
}

impl TestSetup<'_> {
    /// Start building a new test setup.
    pub fn new() -> TestSetupBuilder {
        TestSetupBuilder::new()
    }

    /// Generate a new random address in this test environment.
    pub fn generate_address(&self) -> Address {
        Address::generate(&self.env)
    }
}

// =========================================================================
// Auth Helpers
// =========================================================================

/// Test helper to mock a single contract invocation auth.
///
/// This keeps test files from repeating `env.mock_auths(&[MockAuth { ... }])` blocks.
pub fn mock_auth<A: IntoVal<Env, soroban_sdk::Vec<Val>>>(
    env: &Env,
    contract_id: &Address,
    address: &Address,
    fn_name: &'static str,
    args: A,
) {
    env.mock_auths(&[MockAuth {
        address,
        invoke: &MockAuthInvoke { contract: contract_id, args: args.into_val(env), fn_name, sub_invokes: &[] },
    }]);
}

/// Mock auth for minter-originated `mint(to, amount, operation)`.
pub fn mock_oft_mint_auth(setup: &TestSetup, recipient: &Address, amount: i128) {
    mock_auth(&setup.env, &setup.sac_manager, &setup.minter, "mint", (recipient, amount, &setup.minter));
}
