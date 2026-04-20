use soroban_sdk::{bytes, Address, Bytes, Env, Vec};

use crate::worker_options::{DVN_WORKER_ID, EXECUTOR_OPTION_TYPE_LZRECEIVE, EXECUTOR_WORKER_ID, OPTIONS_TYPE_3};

pub fn create_type3_options(env: &Env, dvns: &Vec<Address>, enable_executor_option: bool) -> Bytes {
    let mut result = bytes!(env);

    result.extend_from_array(&OPTIONS_TYPE_3.to_be_bytes());

    // append executor option
    if enable_executor_option {
        result.extend_from_array(&[EXECUTOR_WORKER_ID]);
        result.extend_from_array(&17u16.to_be_bytes()); // option_size: option_type(1) + data(16) = 17 bytes
        result.extend_from_array(&[EXECUTOR_OPTION_TYPE_LZRECEIVE]); // option_type (1 byte)
        result.extend_from_array(&200000_u128.to_be_bytes()); // execution gas (16 bytes)
    }

    // append dvn options
    for (idx, _dvn) in dvns.iter().enumerate() {
        result.extend_from_array(&[DVN_WORKER_ID]);
        result.extend_from_array(&5u16.to_be_bytes()); // idx(1) + data(4) = 5 bytes
        result.extend_from_array(&[idx as u8]); // dvn_idx
        result.extend_from_array(&1000_u32.to_be_bytes()); // custom data (4 bytes)
    }

    result
}
