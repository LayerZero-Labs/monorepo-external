use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env};
use utils::buffer_writer::BufferWriter;

use crate::{ExecutorFeeLib, ExecutorFeeLibClient};

pub const EXECUTOR_WORKER_ID: u8 = 1;

pub struct TestSetup<'a> {
    pub env: Env,
    pub client: ExecutorFeeLibClient<'a>,
}

impl<'a> TestSetup<'a> {
    pub fn new() -> Self {
        let env = Env::default();
        let owner = Address::generate(&env);
        let contract_id = env.register(ExecutorFeeLib, (&owner,));
        let client = ExecutorFeeLibClient::new(&env, &contract_id);
        Self { env, client }
    }
}

pub fn bytes32(env: &Env, fill: u8) -> BytesN<32> {
    BytesN::from_array(env, &[fill; 32])
}

pub fn option_header(env: &Env, option_type: u8, option_data: Bytes) -> Bytes {
    let mut w = BufferWriter::new(env);
    let option_size = 1u16 + (option_data.len() as u16);
    w.write_u8(EXECUTOR_WORKER_ID).write_u16(option_size).write_u8(option_type).write_bytes(&option_data);
    w.to_bytes()
}

pub fn option_lz_receive(env: &Env, gas: u128, value: Option<u128>) -> Bytes {
    let mut w = BufferWriter::new(env);
    w.write_u128(gas);
    if let Some(v) = value {
        w.write_u128(v);
    }
    option_header(env, message_lib_common::worker_options::EXECUTOR_OPTION_TYPE_LZRECEIVE, w.to_bytes())
}

pub fn option_native_drop(env: &Env, amount: u128, receiver: &BytesN<32>) -> Bytes {
    let mut w = BufferWriter::new(env);
    w.write_u128(amount).write_bytes_n(receiver);
    option_header(env, message_lib_common::worker_options::EXECUTOR_OPTION_TYPE_NATIVE_DROP, w.to_bytes())
}

pub fn option_lz_compose(env: &Env, index: u16, gas: u128, value: Option<u128>) -> Bytes {
    let mut w = BufferWriter::new(env);
    w.write_u16(index).write_u128(gas);
    if let Some(v) = value {
        w.write_u128(v);
    }
    option_header(env, crate::executor_option::EXECUTOR_OPTION_TYPE_LZCOMPOSE, w.to_bytes())
}

pub fn option_ordered_execution(env: &Env) -> Bytes {
    option_header(env, crate::executor_option::EXECUTOR_OPTION_TYPE_ORDERED_EXECUTION, Bytes::new(env))
}
