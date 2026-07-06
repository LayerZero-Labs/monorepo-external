#![no_std]

use soroban_sdk::{contract, contractimpl, Address, BytesN, Env};

#[contract]
pub struct MockFactory;

#[contractimpl]
impl MockFactory {
    /// Deploys a contract on behalf of `deployer` using the given WASM hash and salt.
    /// The deployer must pre-authorize the deployment via CreateContractWithCtorHostFn.
    pub fn deploy(env: Env, deployer: Address, wasm_hash: BytesN<32>, salt: BytesN<32>) -> Address {
        env.deployer()
            .with_address(deployer, salt)
            .deploy_v2(wasm_hash, ())
    }
}
