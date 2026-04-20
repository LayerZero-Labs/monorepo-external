use ed25519_dalek::{Signer, SigningKey};
use rand::thread_rng;
use soroban_sdk::address_payload::AddressPayload;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{
    testutils::{MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    vec, Address, BytesN, Env, IntoVal, Symbol, Val, Vec,
};

use crate::storage::ExecutorHelperConfig;
use crate::{DstConfig, LzExecutor, LzExecutorClient, NativeDropParams, SetDstConfigParam};
use fee_lib_interfaces::FeeParams;

// =============================================================================
// Ed25519 Key Pair (for auth tests that need to sign payloads)
// =============================================================================

pub struct Ed25519KeyPair {
    signing_key: SigningKey,
}

impl Ed25519KeyPair {
    pub fn generate() -> Self {
        Self { signing_key: SigningKey::generate(&mut thread_rng()) }
    }

    pub fn public_key_bytes(&self) -> [u8; 32] {
        self.signing_key.verifying_key().to_bytes()
    }

    pub fn public_key(&self, env: &Env) -> BytesN<32> {
        BytesN::from_array(env, &self.public_key_bytes())
    }

    pub fn address(&self, env: &Env) -> Address {
        Address::from_payload(env, AddressPayload::AccountIdPublicKeyEd25519(self.public_key(env)))
    }

    pub fn sign_payload(&self, env: &Env, payload: &BytesN<32>) -> BytesN<64> {
        let sig = self.signing_key.sign(&payload.to_array());
        BytesN::from_array(env, &sig.to_bytes())
    }
}

// =============================================================================
// Mock Endpoint (only what executor needs: `native_token()`)
// =============================================================================

use soroban_sdk::{contract, contractimpl};

#[contract]
pub struct MockEndpoint;

#[contractimpl]
impl MockEndpoint {
    pub fn __constructor(env: &Env, native_token: &Address) {
        env.storage().instance().set(&Symbol::new(env, "native_token"), native_token);
    }

    pub fn native_token(env: &Env) -> Address {
        env.storage().instance().get(&Symbol::new(env, "native_token")).unwrap()
    }
}

// =============================================================================
// Mock Fee Lib
// =============================================================================

#[contract]
pub struct MockFeeLib;

#[contractimpl]
impl MockFeeLib {
    pub fn get_fee(_env: &Env, _executor: &Address, params: &FeeParams) -> i128 {
        // Deterministic computation so tests can validate the Executor wires FeeParams correctly.
        // Keep it simple and overflow-safe for test ranges we use.
        let mut fee = params.calldata_size as i128;
        fee += params.lz_receive_base_gas as i128;
        fee += params.lz_compose_base_gas as i128;
        fee += params.multiplier_bps as i128;
        fee += (params.floor_margin_usd % 10_000) as i128;
        fee += (params.native_cap % 10_000) as i128;
        // Use default_multiplier_bps only when dst multiplier is 0 to mimic the intended semantics.
        if params.multiplier_bps == 0 {
            fee += params.default_multiplier_bps as i128;
        }
        // Touch these fields so accidental zeroing/regression becomes observable in tests.
        let _ = &params.sender;
        let _ = params.dst_eid;
        let _ = &params.options;
        let _ = &params.price_feed;
        fee
    }

    pub fn version(_env: &Env) -> (u64, u32) {
        (1, 0)
    }
}

// =============================================================================
// Test Setup
// =============================================================================

pub struct TestSetup<'a> {
    pub env: Env,
    pub contract_id: Address,
    pub client: LzExecutorClient<'a>,
    pub owner: Address,
    pub admins: Vec<Address>,
    pub endpoint: Address,
    pub executor_helper: Address,
    pub send_lib: Address,
    pub price_feed: Address,
    pub worker_fee_lib: Address,
    pub deposit_address: Address,
    pub default_multiplier_bps: u32,
    pub native_token: Address,
    pub native_token_admin: Address,
    pub native_token_admin_client: StellarAssetClient<'a>,
}

impl<'a> TestSetup<'a> {
    pub fn new() -> Self {
        let env = Env::default();
        let admin = Address::generate(&env);
        Self::new_with_env_and_admin(env, &admin)
    }

    // For auth tests that need a specific admin address (derived from Ed25519KeyPair)
    pub fn new_with_env_and_admin(env: Env, admin: &Address) -> Self {
        let owner = Address::generate(&env);
        let admins: Vec<Address> = vec![&env, admin.clone()];

        let send_lib = Address::generate(&env);
        let message_libs: Vec<Address> = vec![&env, send_lib.clone()];

        let price_feed = Address::generate(&env);
        let default_multiplier_bps = 10_000u32;
        let deposit_address = Address::generate(&env);

        // Mock endpoint + native token
        let native_token_admin = Address::generate(&env);
        let native_token_sac = env.register_stellar_asset_contract_v2(native_token_admin.clone());
        let native_token = native_token_sac.address();
        let native_token_admin_client = StellarAssetClient::new(&env, &native_token);

        let endpoint = env.register(MockEndpoint, (&native_token,));

        // Mock fee lib
        let worker_fee_lib = env.register(MockFeeLib, ());

        let contract_id = env.register(
            LzExecutor,
            (
                &endpoint,
                &owner,
                &admins,
                &message_libs,
                &price_feed,
                &default_multiplier_bps,
                &worker_fee_lib,
                &deposit_address,
            ),
        );
        let client = LzExecutorClient::new(&env, &contract_id);

        // Register executor helper config directly in storage
        let executor_helper = Address::generate(&env);
        let allowed_functions: Vec<Symbol> =
            vec![&env, Symbol::new(&env, "execute"), Symbol::new(&env, "compose")];
        env.as_contract(&contract_id, || {
            crate::storage::ExecutorStorage::set_executor_helper(
                &env,
                &ExecutorHelperConfig { address: executor_helper.clone(), allowed_functions },
            );
        });

        Self {
            env,
            contract_id,
            client,
            owner,
            admins,
            endpoint,
            executor_helper,
            send_lib,
            price_feed,
            worker_fee_lib,
            deposit_address,
            default_multiplier_bps,
            native_token,
            native_token_admin,
            native_token_admin_client,
        }
    }

    pub fn mock_auth<T: IntoVal<Env, Vec<Val>>>(&self, address: &Address, fn_name: &str, args: T) {
        self.env.mock_auths(&[MockAuth {
            address,
            invoke: &MockAuthInvoke {
                contract: &self.contract_id,
                fn_name,
                args: args.into_val(&self.env),
                sub_invokes: &[],
            },
        }]);
    }

    pub fn mock_owner_auth<T: IntoVal<Env, Vec<Val>>>(&self, fn_name: &str, args: T) {
        self.mock_auth(&self.owner, fn_name, args)
    }

    pub fn mint_native(&self, to: &Address, amount: i128) {
        self.env.mock_auths(&[MockAuth {
            address: &self.native_token_admin,
            invoke: &MockAuthInvoke {
                contract: &self.native_token,
                fn_name: "mint",
                args: (to, amount).into_val(&self.env),
                sub_invokes: &[],
            },
        }]);
        self.native_token_admin_client.mint(to, &amount);
    }

    pub fn set_dst_config_one(&self, admin: &Address, dst_eid: u32, dst_config: &DstConfig) {
        let params: Vec<SetDstConfigParam> =
            vec![&self.env, SetDstConfigParam { dst_eid, dst_config: dst_config.clone() }];
        self.mock_auth(admin, "set_dst_config", (admin, &params));
        self.client.set_dst_config(admin, &params);
    }

    pub fn token_client(&self) -> TokenClient<'_> {
        TokenClient::new(&self.env, &self.native_token)
    }

    pub fn balance_native(&self, addr: &Address) -> i128 {
        self.token_client().balance(addr)
    }

    pub fn new_dst_config(&self, multiplier_bps: u32) -> DstConfig {
        DstConfig {
            lz_receive_base_gas: 100,
            multiplier_bps,
            floor_margin_usd: 1234,
            native_cap: 5678,
            lz_compose_base_gas: 50,
        }
    }

    /// Builds native drop params from receiver + amount vectors.
    ///
    /// This is more flexible than hard-coding "two" and matches how options are typically modeled.
    pub fn native_drop_params(&self, receivers: &Vec<Address>, amounts: &Vec<i128>) -> Vec<NativeDropParams> {
        assert_eq!(receivers.len(), amounts.len(), "receivers/amounts length mismatch");

        let mut out: Vec<NativeDropParams> = Vec::new(&self.env);
        for i in 0..receivers.len() {
            out.push_back(NativeDropParams { receiver: receivers.get(i).unwrap(), amount: amounts.get(i).unwrap() });
        }
        out
    }
}
