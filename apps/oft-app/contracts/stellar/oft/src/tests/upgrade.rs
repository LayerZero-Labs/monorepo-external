extern crate std;

use crate::{integration_tests::setup::setup, OFTClient};
use soroban_sdk::{contractclient, testutils::Address as _, xdr::ToXdr, Address, Env, Symbol};
use upgrader::{Upgrader, UpgraderClient};
use utils::{errors::RbacError, upgradeable::UPGRADER_ROLE};

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

fn register_oft() -> (Env, Address, Address) {
    let setup = setup();
    (setup.env.clone(), setup.chain_a.oft.address.clone(), setup.chain_a.owner.clone())
}

#[test]
fn unauthorized_operator_cannot_upgrade_through_upgrader() {
    let (env, contract, _) = register_oft();
    env.mock_all_auths();

    let operator = Address::generate(&env);
    let upgrader = env.register(Upgrader, ());
    let wasm_hash = env.deployer().upload_contract_wasm(UPGRADE_WASM);

    let result = UpgraderClient::new(&env, &upgrader).try_upgrade_and_migrate(
        &contract,
        &wasm_hash,
        &42_u32.to_xdr(&env),
        &Some(operator),
    );

    assert_eq!(result.err().unwrap().ok().unwrap(), RbacError::Unauthorized.into());
}

#[test]
fn authorized_upgrade_through_upgrader_runs_migration_and_preserves_state() {
    let (env, contract, owner) = register_oft();
    env.mock_all_auths();

    let operator = Address::generate(&env);
    let marker = Symbol::new(&env, "state_marker");
    env.as_contract(&contract, || env.storage().instance().set(&marker, &7_u32));

    let client = OFTClient::new(&env, &contract);
    client.grant_role(&operator, &Symbol::new(&env, UPGRADER_ROLE), &owner);

    let upgrader = env.register(Upgrader, ());
    let wasm_hash = env.deployer().upload_contract_wasm(UPGRADE_WASM);
    UpgraderClient::new(&env, &upgrader).upgrade_and_migrate(
        &contract,
        &wasm_hash,
        &42_u32.to_xdr(&env),
        &Some(operator),
    );

    assert_eq!(UpgradedContractClient::new(&env, &contract).counter2(), 42);
    assert_eq!(env.as_contract(&contract, || env.storage().instance().get(&marker)), Some(7_u32));
}
