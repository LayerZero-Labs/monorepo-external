use soroban_sdk::{Bytes, Env};

pub const EXECUTOR_ID: u8 = 1; // WORKER_ID

pub const LZ_RECEIVE_TYPE: u8 = 1; // OPTION_TYPE

// copied from solana's counter options.rs
pub fn executor_lz_receive_option(env: &Env, gas_limit: u128, value: u128) -> Bytes {
    let mut options = Bytes::new(env);

    options.extend_from_slice(&3u16.to_be_bytes());

    options.push_back(EXECUTOR_ID);

    let gas_limit_bytes = gas_limit.to_be_bytes();
    let value_bytes = value.to_be_bytes();

    if value == 0 {
        options.extend_from_slice(&(gas_limit_bytes.len() as u16 + 1).to_be_bytes());
        options.push_back(LZ_RECEIVE_TYPE);
        options.extend_from_slice(&gas_limit_bytes);
    } else {
        options.extend_from_slice(&((gas_limit_bytes.len() + value_bytes.len()) as u16 + 1).to_be_bytes());
        options.push_back(LZ_RECEIVE_TYPE);
        options.extend_from_slice(&gas_limit_bytes);
        options.extend_from_slice(&value_bytes);
    }

    options
}
