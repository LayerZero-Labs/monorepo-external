// UI (trybuild) test: minimal multisig usage compiles.
//
// Purpose:
// - Verifies `#[common_macros::multisig]` can be applied on a contract struct.
// - Verifies the macro-generated trait impls exist and are type-checkable from downstream code:
//   - `utils::auth::Auth` trait impl for the contract (self-owning authorizer)
//   - `utils::multisig::MultiSig` trait impl for the contract
//
// Note: renamed from `minimal_contract.rs` to `basic.rs` for consistency.

use soroban_sdk::{contract, contractimpl, BytesN, Env, Vec};

#[contract]
#[common_macros::multisig]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn smoke(env: Env) {
        // Auth impl exists.
        let _authorizer = <Self as utils::auth::Auth>::authorizer(&env);

        // MultiSig APIs exist (view + mutation + verification).
        let _threshold: u32 = <Self as utils::multisig::MultiSig>::threshold(&env);
        let signer = BytesN::<20>::from_array(&env, &[1u8; 20]);
        let _is_signer: bool = <Self as utils::multisig::MultiSig>::is_signer(&env, &signer);

        let _signers: Vec<BytesN<20>> = <Self as utils::multisig::MultiSig>::get_signers(&env);
        let _total_signers: u32 = <Self as utils::multisig::MultiSig>::total_signers(&env);

        <Self as utils::multisig::MultiSig>::set_signer(&env, &signer, true);
        <Self as utils::multisig::MultiSig>::set_threshold(&env, 1);

        let digest = BytesN::<32>::from_array(&env, &[0u8; 32]);
        let sig = BytesN::<65>::from_array(&env, &[0u8; 65]);
        let mut signatures = Vec::<BytesN<65>>::new(&env);
        signatures.push_back(sig);
        <Self as utils::multisig::MultiSig>::verify_signatures(&env, &digest, &signatures);
        <Self as utils::multisig::MultiSig>::verify_n_signatures(&env, &digest, &signatures, 1);
    }

    // `only_auth` should be usable with multisig contracts (they implement `Auth`).
    #[common_macros::only_auth]
    pub fn protected(env: Env) {
        let _ = env;
    }
}

fn main() {}
