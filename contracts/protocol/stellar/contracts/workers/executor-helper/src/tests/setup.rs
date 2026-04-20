use endpoint_v2::Origin;
use executor::NativeDropParams;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{MockAuth, MockAuthInvoke},
    token::StellarAssetClient,
    Address, Bytes, BytesN, Env, IntoVal, Symbol, Vec,
};

use crate::{ComposeParams, ExecutionParams, ExecutorHelper, ExecutorHelperClient};

// =============================================================================
// Mock Endpoint (provides native_token and alert recording)
// =============================================================================

#[contract]
pub struct MockEndpoint;

#[contracttype]
#[derive(Clone, Debug)]
pub struct LzReceiveAlertRecord {
    pub executor: Address,
    pub origin: Origin,
    pub receiver: Address,
    pub guid: BytesN<32>,
    pub gas_limit: i128,
    pub value: i128,
    pub message: Bytes,
    pub extra_data: Bytes,
    pub reason: Bytes,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct LzComposeAlertRecord {
    pub executor: Address,
    pub from: Address,
    pub to: Address,
    pub guid: BytesN<32>,
    pub index: u32,
    pub gas_limit: i128,
    pub value: i128,
    pub message: Bytes,
    pub extra_data: Bytes,
    pub reason: Bytes,
}

#[contractimpl]
impl MockEndpoint {
    pub fn __constructor(env: &Env, native_token: &Address) {
        env.storage().instance().set(&Symbol::new(env, "native_token"), native_token);
    }

    pub fn native_token(env: &Env) -> Address {
        env.storage().instance().get(&Symbol::new(env, "native_token")).unwrap()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn lz_receive_alert(
        env: &Env,
        executor: &Address,
        origin: &Origin,
        receiver: &Address,
        guid: &BytesN<32>,
        gas_limit: i128,
        value: i128,
        message: &Bytes,
        extra_data: &Bytes,
        reason: &Bytes,
    ) {
        let record = LzReceiveAlertRecord {
            executor: executor.clone(),
            origin: origin.clone(),
            receiver: receiver.clone(),
            guid: guid.clone(),
            gas_limit,
            value,
            message: message.clone(),
            extra_data: extra_data.clone(),
            reason: reason.clone(),
        };
        env.storage().instance().set(&Symbol::new(env, "lz_receive_alert"), &record);
    }

    pub fn get_lz_receive_alert(env: &Env) -> Option<LzReceiveAlertRecord> {
        env.storage().instance().get(&Symbol::new(env, "lz_receive_alert"))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn lz_compose_alert(
        env: &Env,
        executor: &Address,
        from: &Address,
        to: &Address,
        guid: &BytesN<32>,
        index: u32,
        gas_limit: i128,
        value: i128,
        message: &Bytes,
        extra_data: &Bytes,
        reason: &Bytes,
    ) {
        let record = LzComposeAlertRecord {
            executor: executor.clone(),
            from: from.clone(),
            to: to.clone(),
            guid: guid.clone(),
            index,
            gas_limit,
            value,
            message: message.clone(),
            extra_data: extra_data.clone(),
            reason: reason.clone(),
        };
        env.storage().instance().set(&Symbol::new(env, "lz_compose_alert"), &record);
    }

    pub fn get_lz_compose_alert(env: &Env) -> Option<LzComposeAlertRecord> {
        env.storage().instance().get(&Symbol::new(env, "lz_compose_alert"))
    }
}

// =============================================================================
// Mock Receiver (implements lz_receive)
// =============================================================================

#[contract]
pub struct MockReceiver;

#[contracttype]
#[derive(Clone, Debug)]
pub struct LzReceiveRecord {
    pub executor: Address,
    pub origin: Origin,
    pub guid: BytesN<32>,
    pub message: Bytes,
    pub extra_data: Bytes,
    pub value: i128,
}

#[contractimpl]
impl MockReceiver {
    pub fn __constructor(_env: &Env) {}

    pub fn lz_receive(
        env: &Env,
        executor: &Address,
        origin: &Origin,
        guid: &BytesN<32>,
        message: &Bytes,
        extra_data: &Bytes,
        value: i128,
    ) {
        executor.require_auth();
        let record = LzReceiveRecord {
            executor: executor.clone(),
            origin: origin.clone(),
            guid: guid.clone(),
            message: message.clone(),
            extra_data: extra_data.clone(),
            value,
        };
        env.storage().instance().set(&Symbol::new(env, "lz_receive"), &record);
    }

    pub fn get_lz_receive(env: &Env) -> Option<LzReceiveRecord> {
        env.storage().instance().get(&Symbol::new(env, "lz_receive"))
    }
}

// =============================================================================
// Mock Composer (implements lz_compose)
// =============================================================================

#[contract]
pub struct MockComposer;

#[contracttype]
#[derive(Clone, Debug)]
pub struct LzComposeRecord {
    pub executor: Address,
    pub from: Address,
    pub guid: BytesN<32>,
    pub index: u32,
    pub message: Bytes,
    pub extra_data: Bytes,
    pub value: i128,
}

#[contractimpl]
impl MockComposer {
    pub fn __constructor(_env: &Env) {}

    pub fn lz_compose(
        env: &Env,
        executor: &Address,
        from: &Address,
        guid: &BytesN<32>,
        index: u32,
        message: &Bytes,
        extra_data: &Bytes,
        value: i128,
    ) {
        executor.require_auth();
        let record = LzComposeRecord {
            executor: executor.clone(),
            from: from.clone(),
            guid: guid.clone(),
            index,
            message: message.clone(),
            extra_data: extra_data.clone(),
            value,
        };
        env.storage().instance().set(&Symbol::new(env, "lz_compose"), &record);
    }

    pub fn get_lz_compose(env: &Env) -> Option<LzComposeRecord> {
        env.storage().instance().get(&Symbol::new(env, "lz_compose"))
    }
}

// =============================================================================
// Mock Executor (provides endpoint() and native_drop())
// =============================================================================

#[contract]
pub struct MockExecutor;

#[contracttype]
#[derive(Clone, Debug)]
pub struct NativeDropRecord {
    pub admin: Address,
    pub origin: Origin,
    pub dst_eid: u32,
    pub oapp: Address,
    pub params: Vec<NativeDropParams>,
}

#[contractimpl]
impl MockExecutor {
    pub fn __constructor(env: &Env, endpoint: &Address) {
        env.storage().instance().set(&Symbol::new(env, "endpoint"), endpoint);
    }

    pub fn endpoint(env: &Env) -> Address {
        env.storage().instance().get(&Symbol::new(env, "endpoint")).unwrap()
    }

    pub fn native_drop(
        env: &Env,
        admin: &Address,
        origin: &Origin,
        dst_eid: u32,
        oapp: &Address,
        native_drop_params: &Vec<NativeDropParams>,
    ) {
        admin.require_auth();
        let record = NativeDropRecord {
            admin: admin.clone(),
            origin: origin.clone(),
            dst_eid,
            oapp: oapp.clone(),
            params: native_drop_params.clone(),
        };
        env.storage().instance().set(&Symbol::new(env, "native_drop"), &record);
    }

    pub fn get_native_drop(env: &Env) -> Option<NativeDropRecord> {
        env.storage().instance().get(&Symbol::new(env, "native_drop"))
    }
}

// =============================================================================
// Test Setup
// =============================================================================

pub struct TestSetup<'a> {
    pub env: Env,
    pub executor_helper_client: ExecutorHelperClient<'a>,
    pub executor_helper: Address,
    pub executor: Address,
    pub endpoint: Address,
    pub receiver: Address,
    pub composer: Address,
    pub native_token: Address,
    pub native_token_admin: Address,
    pub native_token_admin_client: StellarAssetClient<'a>,
    pub admin: Address,
}

impl<'a> TestSetup<'a> {
    pub fn new() -> Self {
        let env = Env::default();

        // Native token
        let native_token_admin = Address::generate(&env);
        let native_token_sac = env.register_stellar_asset_contract_v2(native_token_admin.clone());
        let native_token = native_token_sac.address();
        let native_token_admin_client = StellarAssetClient::new(&env, &native_token);

        // Mock endpoint (with native_token)
        let endpoint = env.register(MockEndpoint, (&native_token,));

        // Mock executor (with endpoint reference)
        let executor = env.register(MockExecutor, (&endpoint,));

        // Mock receiver
        let receiver = env.register(MockReceiver, ());

        // Mock composer
        let composer = env.register(MockComposer, ());

        // Admin address (value payer)
        let admin = Address::generate(&env);

        // Register ExecutorHelper contract
        let executor_helper = env.register(ExecutorHelper, ());
        let client = ExecutorHelperClient::new(&env, &executor_helper);

        Self {
            env,
            executor_helper_client: client,
            executor_helper,
            executor,
            endpoint,
            receiver,
            composer,
            native_token,
            native_token_admin,
            native_token_admin_client,
            admin,
        }
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

    pub fn balance_native(&self, addr: &Address) -> i128 {
        soroban_sdk::token::TokenClient::new(&self.env, &self.native_token).balance(addr)
    }

    pub fn mock_lz_receive_auth(&self, executor: &Address, params: &ExecutionParams) {
        if params.value == 0 {
            // No value transfer - executor auth with lz_receive sub-invoke
            self.env.mock_auths(&[MockAuth {
                address: executor,
                invoke: &MockAuthInvoke {
                    contract: &self.executor_helper,
                    fn_name: "execute",
                    args: (executor, params, &self.admin).into_val(&self.env),
                    sub_invokes: &[MockAuthInvoke {
                        contract: &params.receiver,
                        fn_name: "lz_receive",
                        args: (
                            executor,
                            &params.origin,
                            &params.guid,
                            &params.message,
                            &params.extra_data,
                            &params.value,
                        )
                            .into_val(&self.env),
                        sub_invokes: &[],
                    }],
                },
            }]);
        } else {
            // With value transfer - executor auth with lz_receive and transfer sub-invokes
            self.env.mock_auths(&[
                MockAuth {
                    address: executor,
                    invoke: &MockAuthInvoke {
                        contract: &self.executor_helper,
                        fn_name: "execute",
                        args: (executor, params, &self.admin).into_val(&self.env),
                        sub_invokes: &[
                            MockAuthInvoke {
                                contract: &params.receiver,
                                fn_name: "lz_receive",
                                args: (
                                    executor,
                                    &params.origin,
                                    &params.guid,
                                    &params.message,
                                    &params.extra_data,
                                    &params.value,
                                )
                                    .into_val(&self.env),
                                sub_invokes: &[],
                            },
                            MockAuthInvoke {
                                contract: &self.native_token,
                                fn_name: "transfer",
                                args: (&self.admin, executor, &params.value).into_val(&self.env),
                                sub_invokes: &[],
                            },
                        ],
                    },
                },
                MockAuth {
                    address: &self.admin,
                    invoke: &MockAuthInvoke {
                        contract: &self.native_token,
                        fn_name: "transfer",
                        args: (&self.admin, executor, &params.value).into_val(&self.env),
                        sub_invokes: &[],
                    },
                },
            ]);
        }
    }

    pub fn mock_lz_compose_auth(&self, executor: &Address, params: &ComposeParams) {
        if params.value == 0 {
            // No value transfer - executor auth with lz_compose sub-invoke
            self.env.mock_auths(&[MockAuth {
                address: executor,
                invoke: &MockAuthInvoke {
                    contract: &self.executor_helper,
                    fn_name: "compose",
                    args: (executor, params, &self.admin).into_val(&self.env),
                    sub_invokes: &[MockAuthInvoke {
                        contract: &params.to,
                        fn_name: "lz_compose",
                        args: (
                            executor,
                            &params.from,
                            &params.guid,
                            &params.index,
                            &params.message,
                            &params.extra_data,
                            &params.value,
                        )
                            .into_val(&self.env),
                        sub_invokes: &[],
                    }],
                },
            }]);
        } else {
            // With value transfer - executor auth with lz_compose and transfer sub-invokes
            self.env.mock_auths(&[
                MockAuth {
                    address: executor,
                    invoke: &MockAuthInvoke {
                        contract: &self.executor_helper,
                        fn_name: "compose",
                        args: (executor, params, &self.admin).into_val(&self.env),
                        sub_invokes: &[
                            MockAuthInvoke {
                                contract: &params.to,
                                fn_name: "lz_compose",
                                args: (
                                    executor,
                                    &params.from,
                                    &params.guid,
                                    &params.index,
                                    &params.message,
                                    &params.extra_data,
                                    &params.value,
                                )
                                    .into_val(&self.env),
                                sub_invokes: &[],
                            },
                            MockAuthInvoke {
                                contract: &self.native_token,
                                fn_name: "transfer",
                                args: (&self.admin, executor, &params.value).into_val(&self.env),
                                sub_invokes: &[],
                            },
                        ],
                    },
                },
                MockAuth {
                    address: &self.admin,
                    invoke: &MockAuthInvoke {
                        contract: &self.native_token,
                        fn_name: "transfer",
                        args: (&self.admin, executor, &params.value).into_val(&self.env),
                        sub_invokes: &[],
                    },
                },
            ]);
        }
    }

    pub fn mock_native_drop_auth(
        &self,
        executor: &Address,
        admin: &Address,
        origin: &Origin,
        dst_eid: u32,
        oapp: &Address,
        native_drop_params: &Vec<NativeDropParams>,
    ) {
        // native_drop on executor contract only requires admin auth
        self.env.mock_auths(&[MockAuth {
            address: admin,
            invoke: &MockAuthInvoke {
                contract: executor,
                fn_name: "native_drop",
                args: (admin, origin, &dst_eid, oapp, native_drop_params).into_val(&self.env),
                sub_invokes: &[],
            },
        }]);
    }

    pub fn default_origin(&self) -> Origin {
        Origin { src_eid: 1, sender: BytesN::from_array(&self.env, &[1u8; 32]), nonce: 1 }
    }

    pub fn default_guid(&self) -> BytesN<32> {
        BytesN::from_array(&self.env, &[2u8; 32])
    }

    pub fn default_message(&self) -> Bytes {
        Bytes::from_slice(&self.env, &[1, 2, 3, 4])
    }

    pub fn default_extra_data(&self) -> Bytes {
        Bytes::from_slice(&self.env, &[5, 6, 7, 8])
    }

    pub fn default_execution_params(&self) -> ExecutionParams {
        ExecutionParams {
            receiver: self.receiver.clone(),
            origin: self.default_origin(),
            guid: self.default_guid(),
            message: self.default_message(),
            extra_data: self.default_extra_data(),
            value: 0,
            gas_limit: 100,
        }
    }

    pub fn default_compose_params(&self) -> ComposeParams {
        let from = Address::generate(&self.env);
        ComposeParams {
            from,
            to: self.composer.clone(),
            guid: self.default_guid(),
            index: 4,
            message: self.default_message(),
            extra_data: self.default_extra_data(),
            value: 0,
            gas_limit: 100,
        }
    }

    /// Returns the MockReceiverClient to access mock receiver methods
    pub fn receiver_client(&self) -> MockReceiverClient<'_> {
        MockReceiverClient::new(&self.env, &self.receiver)
    }

    /// Returns the MockComposerClient to access mock composer methods
    pub fn composer_client(&self) -> MockComposerClient<'_> {
        MockComposerClient::new(&self.env, &self.composer)
    }

    /// Returns the MockExecutorClient to access mock executor methods
    pub fn executor_client(&self) -> MockExecutorClient<'_> {
        MockExecutorClient::new(&self.env, &self.executor)
    }

    /// Returns the MockEndpointClient to access mock endpoint methods
    pub fn endpoint_client(&self) -> MockEndpointClient<'_> {
        MockEndpointClient::new(&self.env, &self.endpoint)
    }

    /// Mocks all authorizations including non-root - useful for simpler test cases
    pub fn mock_all_auths(&self) {
        self.env.mock_all_auths_allowing_non_root_auth();
    }
}
