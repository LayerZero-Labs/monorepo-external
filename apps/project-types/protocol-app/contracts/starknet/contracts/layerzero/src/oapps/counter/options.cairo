use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
use crate::workers::executor::options::{EXECUTOR_WORKER_ID, OPTION_TYPE_LZRECEIVE};

pub fn executor_lz_receive_option(gas_limit: u128, value: u128) -> ByteArray {
    let mut params = Default::default();
    if value == 0 {
        params.append_u128(gas_limit);
    } else {
        params.append_u128(gas_limit);
        params.append_u128(value);
    }
    let mut options = Default::default();
    options.append_u16(3); // append option type 3
    options.append_u8(EXECUTOR_WORKER_ID); // append worker id
    options.append_u16(params.len().try_into().unwrap() + 1); // append params length
    options.append_u8(OPTION_TYPE_LZRECEIVE); // append option type
    options.append(@params);
    options
}
