// Runtime tests: complete upgrade -> migrate flow.
//
// Note: `upgrade()` swaps the contract WASM, so the `migrate()` invocation that follows is
// executed in the *upgraded* WASM. This test therefore uses `MigrationData = ()` to match the
// upgradeable WASM fixture used in this repo.

use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    xdr::ToXdr,
    Address, Bytes, Env, IntoVal,
};
use utils::upgradeable::{UpgradeableInternal, UpgradeableStorage};

// Upgrade target WASM fixture.
const TEST_UPGRADE_WASM: &[u8] =
    include_bytes!("../../../../upgrader/src/tests/test_data/test_upgradeable_contract1.wasm");

#[contract]
#[common_macros::ownable]
#[common_macros::upgradeable]
pub struct FlowContract;

impl UpgradeableInternal for FlowContract {
    type MigrationData = ();

    fn __migrate(env: &Env, _migration_data: &Self::MigrationData) {
        // Marker in case the upgraded WASM delegates back to our migrate logic.
        env.storage().instance().set(&soroban_sdk::Symbol::new(env, "flow_migrated"), &true);
    }
}

#[contractimpl]
impl FlowContract {
    pub fn init(env: Env, owner: Address) {
        Self::init_owner(&env, &owner);
    }
}

#[test]
fn upgrade_then_migrate_happy_path() {
    let env = Env::default();
    let contract_id = env.register(FlowContract, ());
    let client = FlowContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    client.init(&owner);

    // Upload a real contract WASM so update_current_contract_wasm succeeds.
    let wasm_hash = env.deployer().upload_contract_wasm(Bytes::from_slice(&env, TEST_UPGRADE_WASM));

    // upgrade() should set migrating=true.
    client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "upgrade",
                args: (&wasm_hash,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .upgrade(&wasm_hash);

    env.as_contract(&contract_id, || {
        assert_eq!(UpgradeableStorage::migrating(&env), true);
    });

    // migrate() should be allowed after upgrade and should clear migrating back to false.
    // The upgraded WASM fixture expects XDR-encoded migration data bytes.
    // (This fixture is shared with `upgrader` tests which pass a u32 migration payload.)
    let migration_data = 1u32.to_xdr(&env);
    client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "migrate",
                args: (&migration_data,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .migrate(&migration_data);

    env.as_contract(&contract_id, || {
        assert_eq!(UpgradeableStorage::migrating(&env), false);
    });
}
