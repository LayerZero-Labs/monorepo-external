use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, Env, IntoVal, Val, Vec,
};

use crate::{init_worker, set_admin_by_admin, Worker};

use common_macros::{contract_impl, ownable};
use soroban_sdk::contract;

#[contract]
#[ownable]
pub struct WorkerTester;

#[contract_impl]
impl WorkerTester {
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        env: &Env,
        owner: &Address,
        admins: &Vec<Address>,
        message_libs: &Vec<Address>,
        price_feed: &Address,
        default_multiplier_bps: u32,
        worker_fee_lib: &Address,
        deposit_address: &Address,
    ) {
        Self::init_owner(env, owner);
        init_worker::<Self>(
            env,
            admins,
            message_libs,
            price_feed,
            default_multiplier_bps,
            worker_fee_lib,
            deposit_address,
        );
    }

    /// Test-only wrapper exposing `set_admin_by_admin` as a contract function
    /// so we can exercise auth + storage updates in unit tests.
    pub fn set_admin_by_admin_for_test(env: &Env, caller: &Address, admin: &Address, active: bool) {
        set_admin_by_admin::<Self>(env, caller, admin, active);
    }
}

#[contract_impl(contracttrait)]
impl Worker for WorkerTester {}

mod bare_worker_contract {
    use super::*;

    #[contract]
    #[ownable]
    pub struct BareWorker;

    #[contract_impl]
    impl BareWorker {
        pub fn __constructor(env: &Env, owner: &Address) {
            Self::init_owner(env, owner);
        }
    }

    #[contract_impl(contracttrait)]
    impl Worker for BareWorker {}
}

pub struct TestSetup<'a> {
    pub env: Env,
    pub contract_id: Address,
    pub client: WorkerTesterClient<'a>,
    pub owner: Address,
    pub admins: Vec<Address>,
    pub message_libs: Vec<Address>,
    pub price_feed: Address,
    pub worker_fee_lib: Address,
    pub deposit_address: Address,
    pub default_multiplier_bps: u32,
}

impl<'a> TestSetup<'a> {
    pub fn new() -> Self {
        let env = Env::default();

        let owner = Address::generate(&env);
        let admins: Vec<Address> = soroban_sdk::vec![&env, Address::generate(&env), Address::generate(&env)];
        let message_libs: Vec<Address> = soroban_sdk::vec![&env, Address::generate(&env)];
        let price_feed = Address::generate(&env);
        let worker_fee_lib = Address::generate(&env);
        let deposit_address = Address::generate(&env);
        let default_multiplier_bps = 10_000;

        let contract_id = env.register(
            WorkerTester,
            (&owner, &admins, &message_libs, &price_feed, &default_multiplier_bps, &worker_fee_lib, &deposit_address),
        );
        let client = WorkerTesterClient::new(&env, &contract_id);

        Self {
            env,
            contract_id,
            client,
            owner,
            admins,
            message_libs,
            price_feed,
            worker_fee_lib,
            deposit_address,
            default_multiplier_bps,
        }
    }

    pub fn as_contract<F, R>(&self, f: F) -> R
    where
        F: FnOnce() -> R,
    {
        self.env.as_contract(&self.contract_id, f)
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
}

pub fn bare_worker<'a>(env: &'a Env, owner: &Address) -> (Address, bare_worker_contract::BareWorkerClient<'a>) {
    let contract_id = env.register(bare_worker_contract::BareWorker, (owner,));
    let client = bare_worker_contract::BareWorkerClient::new(env, &contract_id);
    (contract_id, client)
}
