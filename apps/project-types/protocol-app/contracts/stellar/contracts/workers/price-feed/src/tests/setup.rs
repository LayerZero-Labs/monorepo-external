use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    vec, Address, Env, IntoVal, Val, Vec,
};

use crate::{LzPriceFeed, LzPriceFeedClient};
use fee_lib_interfaces::Price;

// =============================================================================
// Test Setup
// =============================================================================

pub struct TestSetup<'a> {
    pub env: Env,
    pub contract_id: Address,
    pub client: LzPriceFeedClient<'a>,
    pub owner: Address,
    pub price_updater: Address,
}

impl<'a> TestSetup<'a> {
    pub fn new() -> Self {
        let env = Env::default();
        let owner = Address::generate(&env);
        let price_updater = Address::generate(&env);

        let contract_id = env.register(LzPriceFeed, (&owner, &price_updater));
        let client = LzPriceFeedClient::new(&env, &contract_id);

        Self { env, contract_id, client, owner, price_updater }
    }

    pub fn mock_auth<T: IntoVal<Env, Vec<Val>>>(&self, address: &Address, fn_name: &str, args: T) {
        self.env.mock_auths(&[MockAuth {
            address,
            invoke: &MockAuthInvoke {
                contract: &self.contract_id,
                fn_name,
                args: args.into_val(&self.env),
                sub_invokes: &[],
            },
        }]);
    }

    pub fn mock_owner_auth<T: IntoVal<Env, Vec<Val>>>(&self, fn_name: &str, args: T) {
        self.mock_auth(&self.owner, fn_name, args)
    }

    pub fn mock_price_updater_auth<T: IntoVal<Env, Vec<Val>>>(&self, fn_name: &str, args: T) {
        self.mock_auth(&self.price_updater, fn_name, args)
    }

    /// Creates a default Price for testing
    pub fn new_price(&self, price_ratio: u128, gas_price_in_unit: u64, gas_per_byte: u32) -> Price {
        Price { price_ratio, gas_price_in_unit, gas_per_byte }
    }

    /// Creates a standard test price
    pub fn default_test_price(&self) -> Price {
        // price_ratio = 1e20 means 1:1 ratio
        Price { price_ratio: 10u128.pow(20), gas_price_in_unit: 1_000_000, gas_per_byte: 16 }
    }

    /// Sets up a default model price for a destination EID
    pub fn setup_default_price(&self, dst_eid: u32, price: &Price) {
        let prices = vec![&self.env, crate::types::UpdatePrice { eid: dst_eid, price: price.clone() }];
        self.mock_price_updater_auth("set_price", (&self.price_updater, &prices));
        self.client.set_price(&self.price_updater, &prices);
    }
}
