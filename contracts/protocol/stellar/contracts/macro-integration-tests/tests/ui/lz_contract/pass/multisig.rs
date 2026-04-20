// UI (trybuild) test: `#[lz_contract(multisig)]` wrapper option compiles.
//
// Purpose:
// - Ensures the `multisig` option switches auth from ownable -> multisig.

use soroban_sdk::{contractimpl, BytesN, Env};
use utils::ttl_configurable::TtlConfig;

#[common_macros::lz_contract(multisig)]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn smoke(env: Env) {
        // Auth impl exists (provided by ownable/multisig, here: multisig).
        let _authorizer = <Self as utils::auth::Auth>::authorizer(&env);

        // MultiSig trait impl exists and is callable.
        let _threshold: u32 = <Self as utils::multisig::MultiSig>::threshold(&env);
        let signer = BytesN::<20>::from_array(&env, &[1u8; 20]);
        let _is_signer: bool = <Self as utils::multisig::MultiSig>::is_signer(&env, &signer);

        let _cfg: (Option<TtlConfig>, Option<TtlConfig>) = Self::ttl_configs(&env);
        Self::extend_instance_ttl(&env, 1, 2);
    }

    // `only_auth` should be usable on multisig lz_contract (it provides an Auth impl).
    #[common_macros::only_auth]
    pub fn protected(env: Env) {
        let _ = env;
    }
}

fn main() {}
