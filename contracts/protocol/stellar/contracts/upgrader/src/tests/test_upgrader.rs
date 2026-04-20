extern crate std;

use soroban_sdk::{contractclient, testutils::Address as _, xdr::ToXdr, Address, BytesN, Env};

use crate::{Upgrader, UpgraderClient};

#[allow(dead_code)]
#[contractclient(name = "TestUpgradeableContractClient")]
trait TestUpgradeableContract {
    fn counter(env: &Env) -> u32;
}

#[allow(dead_code)]
#[contractclient(name = "TestUpgradeableContractClient2")]
trait TestUpgradeableContract2 {
    fn counter2(env: &Env) -> u32;
}

#[allow(dead_code)]
#[contractclient(name = "TestRbacUpgradeableContractClient")]
trait TestRbacUpgradeableContract {
    fn counter(env: &Env) -> u32;
}

#[allow(dead_code)]
#[contractclient(name = "TestRbacUpgradeableContractClient2")]
trait TestRbacUpgradeableContract2 {
    fn counter(env: &Env) -> u32;
    fn counter2(env: &Env) -> u32;
}

mod contract_v1 {
    //#![no_std]

    // use soroban_sdk::{contractimpl, Env, Symbol, Address, contractclient};
    // use utils::{ upgradeable::UpgradeableInternal};
    // use common_macros::lz_contract;

    // #[lz_contract(upgradeable)]
    // pub struct DummyContract;

    // impl UpgradeableInternal for DummyContract {
    //     type MigrationData = u32;

    //     fn __migrate(env: &Env, migration_data: &Self::MigrationData) {
    //         env.storage().instance().set(&Symbol::new(env, "counter2"), migration_data);
    //     }
    // }

    // #[contractclient(name = "TestUpgradeableClient")]
    // trait TestUpgradeable {
    //     fn counter(env: &Env) -> u32;
    // }

    // #[contractimpl]
    // impl TestUpgradeable for DummyContract {
    //     fn counter(env: &Env) -> u32 {
    //         env.storage().instance().get(&Symbol::new(env, "counter")).unwrap_or(0)
    //     }
    // }

    // #[contractimpl]
    // impl DummyContract {
    //     pub fn __constructor(env: &Env, owner: &Address) {
    //         Self::init_owner(env, owner);
    //         env.storage().instance().set(&Symbol::new(env, "counter"), &1_u32);
    //     }
    // }
    soroban_sdk::contractimport!(file = "./src/tests/test_data/test_upgradeable_contract1.wasm");
}
mod contract_v2 {
    //#![no_std]

    // use soroban_sdk::{contractimpl, Env, Symbol, Address, contractclient};
    // use utils::{ upgradeable::UpgradeableInternal};
    // use common_macros::lz_contract;

    // #[lz_contract(upgradeable)]
    // pub struct DummyContract;

    // impl UpgradeableInternal for DummyContract {
    //     type MigrationData = u32;

    //     fn __migrate(env: &Env, migration_data: &Self::MigrationData) {
    //         env.storage().instance().set(&Symbol::new(env, "counter2"), migration_data);
    //     }
    // }

    // #[contractclient(name = "TestUpgradeableClient")]
    // trait TestUpgradeable {
    //     fn counter(env: &Env) -> u32;
    //     fn counter2(env: &Env) -> u32;
    // }

    // #[contractimpl]
    // impl TestUpgradeable for DummyContract {
    //     fn counter(env: &Env) -> u32 {
    //         env.storage().instance().get(&Symbol::new(env, "counter")).unwrap_or(0)
    //     }

    //     fn counter2(env: &Env) -> u32 {
    //         env.storage().instance().get(&Symbol::new(env, "counter2")).unwrap_or(0)
    //     }
    // }

    // #[contractimpl]
    // impl DummyContract {
    //     pub fn __constructor(env: &Env, owner: &Address) {
    //         Self::init_owner(env, owner);
    //         env.storage().instance().set(&Symbol::new(env, "counter"), &1_u32);
    //     }
    // }
    soroban_sdk::contractimport!(file = "./src/tests/test_data/test_upgradeable_contract2.wasm");
}

mod contract_v3 {
    soroban_sdk::contractimport!(file = "./src/tests/test_data/test_upgradeable_contract3.wasm");
}
mod contract_v4 {
    soroban_sdk::contractimport!(file = "./src/tests/test_data/test_upgradeable_contract4.wasm");
}

fn install_new_wasm(e: &Env) -> BytesN<32> {
    e.deployer().upload_contract_wasm(contract_v2::WASM)
}

#[test]
fn test_upgrade_with_upgrader() {
    let e = Env::default();
    e.mock_all_auths();

    let owner = Address::generate(&e);
    let contract_id = e.register(contract_v1::WASM, (&owner,));
    let client_v1 = TestUpgradeableContractClient::new(&e, &contract_id);
    assert_eq!(client_v1.counter(), 1);

    let upgrader = e.register(Upgrader, ());
    let upgrader_client = UpgraderClient::new(&e, &upgrader);

    let new_wasm_hash = install_new_wasm(&e);
    let counter_value = 2_u32;
    // Encode migration data as XDR bytes
    let migration_data = counter_value.to_xdr(&e);
    upgrader_client.upgrade_and_migrate(&contract_id, &new_wasm_hash, &migration_data, &None);

    let client_v2 = TestUpgradeableContractClient2::new(&e, &contract_id);

    assert_eq!(client_v2.counter2(), counter_value);
}

#[test]
fn test_upgrade_without_migration_data_returns_error_for_non_unit_migration() {
    let e = Env::default();
    e.mock_all_auths();

    let owner = Address::generate(&e);
    let contract_id = e.register(contract_v1::WASM, (&owner,));

    let upgrader = e.register(Upgrader, ());
    let upgrader_client = UpgraderClient::new(&e, &upgrader);

    let new_wasm_hash = install_new_wasm(&e);
    // The upgradeable WASM fixture requires non-unit migration data (u32).
    // `Upgrader::upgrade` always passes empty `()` migration bytes, so this must fail.
    let res = upgrader_client.try_upgrade(&contract_id, &new_wasm_hash, &None);
    assert_eq!(res.err().unwrap().unwrap(), utils::errors::UpgradeableError::InvalidMigrationData.into());
}

#[test]
fn test_upgrade_with_upgrader_rbac() {
    let e = Env::default();
    e.mock_all_auths();

    let owner = Address::generate(&e);
    let operator = Address::generate(&e);
    // RBAC fixture constructor: (owner, upgrader_operator)
    let contract_id = e.register(contract_v3::WASM, (&owner, &operator));
    let client_v3 = TestRbacUpgradeableContractClient::new(&e, &contract_id);
    assert_eq!(client_v3.counter(), 1);

    let upgrader = e.register(Upgrader, ());
    let upgrader_client = UpgraderClient::new(&e, &upgrader);

    let new_wasm_hash = e.deployer().upload_contract_wasm(contract_v4::WASM);
    let counter_value = 42_u32;
    let migration_data = counter_value.to_xdr(&e);
    // Use RBAC path: pass Some(operator) so the upgrader uses UpgradeableRbac and operator must have signed
    upgrader_client.upgrade_and_migrate(&contract_id, &new_wasm_hash, &migration_data, &Some(operator));

    let client_v4 = TestRbacUpgradeableContractClient2::new(&e, &contract_id);
    assert_eq!(client_v4.counter(), 1);
    assert_eq!(client_v4.counter2(), counter_value);
}
