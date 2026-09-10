extern crate std;

use crate::{SACManager, SACManagerClient};
use soroban_sdk::{
    contract, contractclient, contractimpl, testutils::Address as _, xdr::ToXdr, Address, Bytes, BytesN, Env, Symbol,
};
use utils::{
    errors::RbacError,
    upgradeable::{UpgradeableRbacClient, UPGRADER_ROLE},
};

// RBAC upgrade fixture: migration decodes a u32 from XDR and stores it under
// `counter2` in instance storage; counter2() reads it back to verify migration ran.
// Core set/get logic, illustrated in Rust:
//   fn __migrate(env: &Env, value: &u32) {
//       env.storage().instance().set(&Symbol::new(env, "counter2"), value);
//   }
//   fn counter2(env: &Env) -> u32 {
//       env.storage().instance().get(&Symbol::new(env, "counter2")).unwrap()
//   }
const UPGRADE_WASM: &[u8] = include_bytes!("test_data/test_upgradeable_contract.wasm");

#[allow(dead_code)]
#[contractclient(name = "UpgradedContractClient")]
trait UpgradedContract {
    fn counter2(env: &Env) -> u32;
}

#[contract]
struct TestUpgrader;

#[contractimpl]
impl TestUpgrader {
    pub fn upgrade_and_migrate(
        env: &Env,
        contract: &Address,
        wasm_hash: &BytesN<32>,
        migration_data: &Bytes,
        operator: &Address,
    ) {
        operator.require_auth();
        let client = UpgradeableRbacClient::new(env, contract);
        client.upgrade(wasm_hash, operator);
        client.migrate(migration_data, operator);
    }
}

fn register_sac_manager(env: &Env) -> (Address, Address) {
    let owner = Address::generate(env);
    let sac = Address::generate(env);
    let contract = env.register(SACManager, (&sac, &owner));
    (contract, owner)
}

#[test]
fn unauthorized_operator_cannot_upgrade_through_upgrader() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _) = register_sac_manager(&env);
    let operator = Address::generate(&env);
    let upgrader = env.register(TestUpgrader, ());
    let wasm_hash = env.deployer().upload_contract_wasm(UPGRADE_WASM);

    let result = TestUpgraderClient::new(&env, &upgrader).try_upgrade_and_migrate(
        &contract,
        &wasm_hash,
        &42_u32.to_xdr(&env),
        &operator,
    );

    assert_eq!(result.err().unwrap().ok().unwrap(), RbacError::Unauthorized.into());
}

#[test]
fn authorized_upgrade_through_upgrader_runs_migration_and_preserves_state() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, owner) = register_sac_manager(&env);
    let operator = Address::generate(&env);
    let marker = Symbol::new(&env, "state_marker");
    env.as_contract(&contract, || env.storage().instance().set(&marker, &7_u32));

    let client = SACManagerClient::new(&env, &contract);
    client.grant_role(&operator, &Symbol::new(&env, UPGRADER_ROLE), &owner);

    let upgrader = env.register(TestUpgrader, ());
    let wasm_hash = env.deployer().upload_contract_wasm(UPGRADE_WASM);
    TestUpgraderClient::new(&env, &upgrader).upgrade_and_migrate(
        &contract,
        &wasm_hash,
        &42_u32.to_xdr(&env),
        &operator,
    );

    assert_eq!(UpgradedContractClient::new(&env, &contract).counter2(), 42);
    assert_eq!(env.as_contract(&contract, || env.storage().instance().get(&marker)), Some(7_u32));
}
