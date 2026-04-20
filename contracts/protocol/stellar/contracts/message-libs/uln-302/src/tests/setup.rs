use common_macros::contract_impl;
use endpoint_v2::{FeeRecipient, MessageLibClient, MessageLibManagerClient, Origin, SetConfigParam};
use message_lib_common::interfaces::{ILayerZeroDVN, ILayerZeroExecutor, ILayerZeroTreasury};
use soroban_sdk::{
    contract, log, symbol_short,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    vec, Address, Bytes, BytesN, Env, IntoVal, Vec,
};

use crate::{
    interfaces::{ExecutorConfig, SetDefaultExecutorConfigParam, SetDefaultUlnConfigParam, UlnConfig},
    Uln302, Uln302Client,
};

// endpoint is set to SRC_EID, for receiving, the dst_eid is SRC_EID sent from DST_EID
pub const LOCAL_EID: u32 = 30010;
pub const REMOTE_EID: u32 = 30011;
pub const CONFIRMATIONS: u64 = 1;
pub const MAX_MESSAGE_SIZE: u32 = 10000;
pub const DVN_FEE: [i128; 5] = [1000, 2000, 3000, 4000, 5000];
pub const EXECUTOR_FEE: i128 = 2000;
pub const TREASURY_NATIVE_FEE: i128 = 50;
pub const TREASURY_ZRO_FEE: i128 = 100;

pub struct TestSetup<'a> {
    pub env: Env,
    pub owner: Address,
    pub endpoint: MessageLibManagerClient<'a>,
    pub uln302: Uln302Client<'a>,
    pub executors: Vec<Address>,
    pub dvns: Vec<Address>,
    pub treasury: DummyTreasuryClient<'a>,
}

#[contract]
struct DummyEndpoint;

#[contract_impl]
impl DummyEndpoint {
    pub fn eid(_env: &Env) -> u32 {
        LOCAL_EID
    }

    pub fn set_config(env: &Env, _caller: &Address, oapp: &Address, lib: &Address, params: &Vec<SetConfigParam>) {
        let msglib = MessageLibClient::new(env, lib);
        msglib.set_config(oapp, params);
    }

    pub fn verify(_env: &Env, _lib: &Address, _origin: &Origin, _receiver: &Address, _payload_hash: &BytesN<32>) {
        // do nothing
    }
}

#[contract]
struct DummyDVN;

#[contract_impl]
impl DummyDVN {
    pub fn __constructor(env: &Env, fee: i128) {
        env.storage().persistent().set(&symbol_short!("fee"), &fee);
        env.storage().persistent().set(&symbol_short!("recipient"), &Address::generate(env));
    }

    pub fn fee(env: &Env) -> i128 {
        env.storage().persistent().get(&symbol_short!("fee")).unwrap()
    }

    pub fn recipient(env: &Env) -> Address {
        env.storage().persistent().get(&symbol_short!("recipient")).unwrap()
    }
}

#[contract_impl]
impl ILayerZeroDVN for DummyDVN {
    fn get_fee(
        env: &Env,
        _send_lib: &Address,
        _sender: &Address,
        _dst_eid: u32,
        _packet_header: &Bytes,
        _payload_hash: &BytesN<32>,
        _confirmations: u64,
        _options: &Bytes,
    ) -> i128 {
        env.storage().persistent().get(&symbol_short!("fee")).unwrap()
    }

    fn assign_job(
        env: &Env,
        _send_lib: &Address,
        _sender: &Address,
        _dst_eid: u32,
        _packet_header: &Bytes,
        _payload_hash: &BytesN<32>,
        _confirmations: u64,
        _options: &Bytes,
    ) -> FeeRecipient {
        FeeRecipient {
            to: env.storage().persistent().get(&symbol_short!("recipient")).unwrap(),
            amount: env.storage().persistent().get(&symbol_short!("fee")).unwrap(),
        }
    }
}

#[contract]
struct DummyExecutor;

#[contract_impl]
impl DummyExecutor {
    pub fn __constructor(env: &Env, fee: i128) {
        env.storage().persistent().set(&symbol_short!("fee"), &fee);
        env.storage().persistent().set(&symbol_short!("recipient"), &Address::generate(env));
    }

    pub fn recipient(env: &Env) -> Address {
        env.storage().persistent().get(&symbol_short!("recipient")).unwrap()
    }
}

#[contract_impl]
impl ILayerZeroExecutor for DummyExecutor {
    fn get_fee(
        env: &Env,
        _send_lib: &Address,
        _sender: &Address,
        _dst_eid: u32,
        _calldata_size: u32,
        _options: &Bytes,
    ) -> i128 {
        env.storage().persistent().get(&symbol_short!("fee")).unwrap()
    }

    fn assign_job(
        env: &Env,
        _send_lib: &Address,
        _sender: &Address,
        _dst_eid: u32,
        _calldata_size: u32,
        _options: &Bytes,
    ) -> FeeRecipient {
        FeeRecipient {
            to: env.storage().persistent().get(&symbol_short!("recipient")).unwrap(),
            amount: env.storage().persistent().get(&symbol_short!("fee")).unwrap(),
        }
    }
}

#[contract]
struct DummyTreasury;

#[contract_impl]
impl DummyTreasury {
    pub fn __constructor(env: &Env, native_fee: i128, zro_fee: i128) {
        env.storage().persistent().set(&symbol_short!("nt_fee"), &native_fee);
        env.storage().persistent().set(&symbol_short!("zro_fee"), &zro_fee);
    }

    pub fn native_fee(env: &Env) -> i128 {
        env.storage().persistent().get(&symbol_short!("nt_fee")).unwrap()
    }

    pub fn zro_fee(env: &Env) -> i128 {
        env.storage().persistent().get(&symbol_short!("zro_fee")).unwrap()
    }

    pub fn set_native_fee(env: &Env, native_fee: i128) {
        env.storage().persistent().set(&symbol_short!("nt_fee"), &native_fee);
    }

    pub fn set_zro_fee(env: &Env, zro_fee: i128) {
        env.storage().persistent().set(&symbol_short!("zro_fee"), &zro_fee);
    }
}

#[contract_impl]
impl ILayerZeroTreasury for DummyTreasury {
    fn get_fee(env: &Env, _sender: &Address, _dst_eid: u32, _total_native_fee: i128, pay_in_zro: bool) -> i128 {
        if pay_in_zro {
            Self::zro_fee(env)
        } else {
            Self::native_fee(env)
        }
    }
}

pub fn setup<'a>() -> TestSetup<'a> {
    let env = Env::default();
    let owner = Address::generate(&env);

    let endpoint = env.register(DummyEndpoint, ());
    let treasury = env.register(DummyTreasury, (&0i128, &0i128));

    let uln = env.register(Uln302, (&owner, &endpoint, &treasury));
    let executors = vec![&env];
    let dvns = vec![&env];

    let uln_client = Uln302Client::new(&env, &uln);
    let endpoint_client = MessageLibManagerClient::new(&env, &endpoint);
    let treasury_client = DummyTreasuryClient::new(&env, &treasury);

    log!(&env, "owner: {}", owner);
    log!(&env, "endpoint: {}", endpoint);
    log!(&env, "uln: {}", uln);
    log!(&env, "treasury: {}", treasury);

    TestSetup { env, owner, endpoint: endpoint_client, uln302: uln_client, executors, dvns, treasury: treasury_client }
}

impl<'a> TestSetup<'a> {
    pub fn register_executable_address(&self) -> Address {
        self.env.register(DummyExecutor, (0i128,))
    }

    pub fn set_default_send_uln_config(&self, eid: u32, config: UlnConfig) {
        let params = vec![&self.env, SetDefaultUlnConfigParam { eid, config }];
        self.env.mock_auths(&[MockAuth {
            address: &self.owner,
            invoke: &MockAuthInvoke {
                contract: &self.uln302.address,
                fn_name: "set_default_send_uln_configs",
                args: (&params,).into_val(&self.env),
                sub_invokes: &[],
            },
        }]);
        self.uln302.set_default_send_uln_configs(&params);
    }

    pub fn set_default_receive_uln_config(&self, eid: u32, config: UlnConfig) {
        let params = vec![&self.env, SetDefaultUlnConfigParam { eid, config }];
        self.env.mock_auths(&[MockAuth {
            address: &self.owner,
            invoke: &MockAuthInvoke {
                contract: &self.uln302.address,
                fn_name: "set_default_receive_uln_configs",
                args: (&params,).into_val(&self.env),
                sub_invokes: &[],
            },
        }]);
        self.uln302.set_default_receive_uln_configs(&params);
    }

    pub fn set_default_executor_config(&self, eid: u32, config: ExecutorConfig) {
        let params = vec![&self.env, SetDefaultExecutorConfigParam { dst_eid: eid, config }];
        self.env.mock_auths(&[MockAuth {
            address: &self.owner,
            invoke: &MockAuthInvoke {
                contract: &self.uln302.address,
                fn_name: "set_default_executor_configs",
                args: (&params,).into_val(&self.env),
                sub_invokes: &[],
            },
        }]);
        self.uln302.set_default_executor_configs(&params);
    }

    /// Sets all three default configs (executor, send ULN, receive ULN) for an EID.
    /// This is required for `is_supported_eid` to return true.
    pub fn set_default_configs(&self, eid: u32, uln_config: UlnConfig) {
        let executor_config = ExecutorConfig::generate(&self.env, 10000);
        self.set_default_executor_config(eid, executor_config);
        self.set_default_send_uln_config(eid, uln_config.clone());
        self.set_default_receive_uln_config(eid, uln_config);
    }

    pub fn register_executor(&mut self, fee: i128) -> Address {
        let executor = self.env.register(DummyExecutor, (fee,));
        self.executors.push_back(executor.clone());
        log!(&self.env, "registered executor: {}", executor);
        executor
    }

    pub fn register_dvn(&mut self, fee: i128) -> Address {
        let dvn = self.env.register(DummyDVN, (fee,));
        self.dvns.push_back(dvn.clone());
        log!(&self.env, "registered dvn: {}", dvn);
        dvn
    }
}
