// Runtime tests: `#[lz_contract(multisig)]` wrapper macro.

use soroban_sdk::{
    testutils::{storage::Instance as _, Ledger as _},
    BytesN, Env, Vec,
};

#[common_macros::lz_contract(multisig)]
pub struct MultisigLzContract;

#[test]
fn uses_self_owning_auth_and_exposes_ttl() {
    let env = Env::default();
    let contract_id = env.register(MultisigLzContract, ());
    let client = MultisigLzContractClient::new(&env, &contract_id);

    // MultiSig auth => authorizer should be the contract address, without any init.
    let expected = env.as_contract(&contract_id, || env.current_contract_address());
    assert_eq!(client.authorizer(), Some(expected));

    // TTL-configurable read methods exist.
    let _cfg = client.ttl_configs();
    let _frozen = client.is_ttl_configs_frozen();

    // MultiSig view methods exist.
    assert_eq!(client.threshold(), 0);
    assert_eq!(client.total_signers(), 0);
    let signer = BytesN::<20>::from_array(&env, &[1u8; 20]);
    assert!(!client.is_signer(&signer));
    let signers: Vec<BytesN<20>> = client.get_signers();
    assert_eq!(signers.len(), 0);

    // ttl_extendable entry exists and extends instance TTL.
    env.as_contract(&contract_id, || {
        env.storage().instance().set(&soroban_sdk::Symbol::new(&env, "seed"), &true);
    });

    let before = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    let before_seq = env.ledger().sequence();
    let live_until = before_seq + before;

    env.ledger().set_sequence_number(live_until.saturating_sub(1));
    client.extend_instance_ttl(&1, &50);

    let after = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    assert_eq!(after, 50);
}
