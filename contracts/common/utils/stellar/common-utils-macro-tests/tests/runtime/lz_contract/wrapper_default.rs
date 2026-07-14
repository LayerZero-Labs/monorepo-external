// Runtime tests: `#[lz_contract]` wrapper macro (default options).

use soroban_sdk::{
    contractimpl,
    testutils::{storage::Instance as _, Address as _, Ledger as _, MockAuth, MockAuthInvoke},
    xdr::{ScErrorCode, ScErrorType},
    Address, Env, Error, IntoVal,
};
use utils::ttl_configurable::TtlConfig;

#[common_macros::lz_contract]
pub struct TestContract;

#[contractimpl]
impl TestContract {
    pub fn init(env: Env, owner: Address) {
        Self::init_owner(&env, &owner);
    }
}

#[test]
fn exposes_ttl_and_ownable_features() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    // Ownable helper works.
    let owner = Address::generate(&env);
    client.init(&owner);
    assert_eq!(client.authorizer(), Some(owner));

    // TTL-configurable read methods exist.
    let _cfg = client.ttl_configs();
    let _frozen = client.is_ttl_configs_frozen();

    // ttl_extendable entry exists and extends instance TTL.
    env.as_contract(&contract_id, || {
        env.storage().instance().set(&soroban_sdk::Symbol::new(&env, "seed"), &true);
    });

    let before = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    let before_seq = env.ledger().sequence();
    let live_until = before_seq + before;

    // Reduce current TTL to a small value, then extend to a known target.
    env.ledger().set_sequence_number(live_until.saturating_sub(1));
    client.extend_instance_ttl(&1, &50);

    let after = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    assert_eq!(after, 50);
}

#[test]
fn ttl_configurable_write_requires_owner_auth_and_roundtrips() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    client.init(&owner);

    let instance = Some(TtlConfig::new(1, 2));
    let none: Option<TtlConfig> = None;

    // Unauthorized set should fail.
    let unauthorized = client.try_set_ttl_configs(&instance, &none);
    assert_eq!(
        unauthorized.unwrap_err().unwrap(),
        Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
    );

    // Authorized set should succeed and be readable back.
    client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_ttl_configs",
                args: (&instance, &none).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .set_ttl_configs(&instance, &none);

    assert_eq!(client.ttl_configs(), (instance, none));
}
