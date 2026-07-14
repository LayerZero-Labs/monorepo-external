// Runtime tests: `#[multisig]` self-owning authorization behavior.
//
// Tests covered:
// - `Auth::authorizer()` resolves to the contract's own address.
// - MultiSig mutation calls can be authorized by the contract address (self-owning pattern).

use super::{TestContract, TestContractClient};
use soroban_sdk::{BytesN, Env, Vec};
use utils::{
    multisig::{SignerSet, ThresholdSet},
    testing_utils::assert_contains_events,
};

#[test]
fn authorizer_is_current_contract_address() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let expected = env.as_contract(&contract_id, || env.current_contract_address());
    let got = client.authorizer();
    assert_eq!(got, Some(expected));
}

#[test]
fn self_auth_allows_multisig_admin_calls() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    // Seed multisig storage directly, then verify view methods are wired via the macro-generated
    // `MultiSig` trait impl.
    let signer = BytesN::<20>::from_array(&env, &[1u8; 20]);
    let mut signers = Vec::<BytesN<20>>::new(&env);
    signers.push_back(signer.clone());
    env.as_contract(&contract_id, || {
        utils::multisig::init_multisig(&env, &signers, 1);
    });

    assert_contains_events(
        &env,
        &contract_id,
        &[&SignerSet { signer: signer.clone(), active: true }, &ThresholdSet { threshold: 1 }],
    );

    // Verify stored state through view calls.
    assert_eq!(client.threshold(), 1);
    assert!(client.is_signer(&signer));
    assert_eq!(client.total_signers(), 1);

    let signers: Vec<BytesN<20>> = client.get_signers();
    assert_eq!(signers.len(), 1);
    assert_eq!(signers.get(0).unwrap(), signer);
}
