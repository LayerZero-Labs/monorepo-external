//! Executor decode tests

use core::num::traits::Pow;
use layerzero::workers::executor::errors;
use layerzero::workers::executor::options::{
    OPTION_TYPE_LZCOMPOSE, OPTION_TYPE_LZREAD, OPTION_TYPE_LZRECEIVE, OPTION_TYPE_NATIVE_DROP,
    OPTION_TYPE_ORDERED_EXECUTION, PriceFeedParams,
};
use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
use lz_utils::bytes::Bytes32;
use starkware_utils_testing::test_utils::assert_panic_with_error;
use crate::mocks::workers::executor::decode::interface::{
    IMockExecutorDecodeDispatcherTrait, IMockExecutorDecodeSafeDispatcherTrait,
};
use crate::workers::executor::utils::{
    ExecutorDecodeMock, ExecutorOptionBytes, deploy_executor_decode, serialize_executor_options,
    serialize_lz_compose_option, serialize_lz_read_option, serialize_lz_receive_option,
    serialize_native_drop_option,
};

#[test]
fn test_decode_executor_options_with_ordered_option() {
    let options = serialize_executor_options(
        array![
            ExecutorOptionBytes {
                option_type: OPTION_TYPE_LZRECEIVE,
                option: serialize_lz_receive_option(100, Option::Some(50)),
            },
            ExecutorOptionBytes {
                option_type: OPTION_TYPE_ORDERED_EXECUTION, option: Default::default(),
            },
        ],
    );
    let is_read = false;
    let v1_eid = false;
    let native_cap = 100;
    let lz_receive_base_gas = 100;
    let lz_compose_base_gas = 100;

    let ExecutorDecodeMock { dispatcher, .. } = deploy_executor_decode();
    let parsed_options = dispatcher.parse_options_to_array(options.clone());
    let agg_options = dispatcher
        .aggregate_options(parsed_options.span(), is_read, v1_eid, native_cap);

    let res = dispatcher
        .decode_executor_options(
            is_read, v1_eid, lz_receive_base_gas, lz_compose_base_gas, native_cap, options,
        );

    let expected_total_gas =
        204; // (100 + 100 + (100 * 0)) * 1.02 => (lz_receive_base_gas + total_gas + lz_compose_base_gas * num_lz_compose) * 102 / 100

    let expected_decoded_executor_options = PriceFeedParams {
        total_value: agg_options.total_value.into(),
        total_gas: expected_total_gas,
        calldata_size: agg_options.calldata_size,
    };

    assert(res == expected_decoded_executor_options, 'invalid decoded_executor');
}

#[test]
fn test_decode_executor_options() {
    let options = serialize_executor_options(
        array![
            ExecutorOptionBytes {
                option_type: OPTION_TYPE_LZRECEIVE,
                option: serialize_lz_receive_option(100, Option::Some(50)),
            },
        ],
    );
    let is_read = false;
    let v1_eid = false;
    let native_cap = 100;
    let lz_receive_base_gas = 100;
    let lz_compose_base_gas = 100;

    let ExecutorDecodeMock { dispatcher, .. } = deploy_executor_decode();
    let parsed_options = dispatcher.parse_options_to_array(options.clone());
    let agg_options = dispatcher
        .aggregate_options(parsed_options.span(), is_read, v1_eid, native_cap);

    let res = dispatcher
        .decode_executor_options(
            is_read, v1_eid, lz_receive_base_gas, lz_compose_base_gas, native_cap, options,
        );
    let expected_total_gas =
        200; // 100 + 100 + (100 * 0) => (lz_receive_base_gas + total_gas + lz_compose_base_gas * num_lz_compose)

    let expected_decoded_executor_options = PriceFeedParams {
        total_value: agg_options.total_value.into(),
        total_gas: expected_total_gas,
        calldata_size: agg_options.calldata_size,
    };

    assert(res == expected_decoded_executor_options, 'invalid decoded_executor');
}


#[test]
fn test_apply_premium_to_gas_with_non_zero_but_multiplier_wins() {
    let fee = 100;
    let multiplier_bps = 21000;
    let margin_usd = 100;
    let native_price_usd = 100_u128.pow(9);

    let ExecutorDecodeMock { dispatcher, .. } = deploy_executor_decode();
    let res = dispatcher
        .apply_premium_to_gas(fee, multiplier_bps, 10000, margin_usd, native_price_usd);

    // result with margin is 200, but with multiplier is 210
    assert(res == 210, 'multiplier should win');
}

#[test]
fn test_apply_premium_to_gas_with_native_price_usd_and_margin_usd_non_zero() {
    let fee = 100;
    let multiplier_bps = 5000;
    let margin_usd = 100;
    let native_price_usd = 100_u128.pow(9);

    let ExecutorDecodeMock { dispatcher, .. } = deploy_executor_decode();
    let res = dispatcher
        .apply_premium_to_gas(fee, multiplier_bps, 10000, margin_usd, native_price_usd);
    assert(res == 200, 'invalid res');
}

#[test]
fn test_apply_premium_to_gas_with_native_price_usd_and_margin_usd_zero() {
    let fee = 100;
    let multiplier_bps = 5000;
    let margin_usd = 0;
    let native_price_usd = 0;

    let ExecutorDecodeMock { dispatcher, .. } = deploy_executor_decode();
    let res = dispatcher
        .apply_premium_to_gas(fee, multiplier_bps, 10000, margin_usd, native_price_usd);
    assert(res == 50, 'invalid res');
}

#[test]
fn test_convert_and_apply_premium_to_gas_when_value_is_zero() {
    let value = 0;
    let ratio = 150;
    let denom = 100;
    let multiplier_bps = 10000;

    let ExecutorDecodeMock { dispatcher, .. } = deploy_executor_decode();
    let res = dispatcher
        .convert_and_apply_premium_to_value(value, ratio, denom, multiplier_bps, 10000);
    assert(res == 0, 'invalid res');
}

#[test]
fn test_convert_and_apply_premium_to_value() {
    let value = 200;
    let ratio = 150;
    let denom = 100;
    let multiplier_bps = 10000;

    let ExecutorDecodeMock { dispatcher, .. } = deploy_executor_decode();
    let res = dispatcher
        .convert_and_apply_premium_to_value(value, ratio, denom, multiplier_bps, 10000);
    assert(res == 300, 'invalid res');
}

#[test]
#[feature("safe_dispatcher")]
fn test_aggregate_options_with_unsupported_option_lz_read() {
    let options = serialize_executor_options(
        array![
            ExecutorOptionBytes {
                option_type: OPTION_TYPE_LZREAD,
                option: serialize_lz_read_option(100, 100, Option::Some(50)),
            },
        ],
    );

    // It's not allowed to have lz read when is read is false
    let is_read = false;
    let v1_eid = false;
    let native_cap = 0;

    let ExecutorDecodeMock { safe_dispatcher, .. } = deploy_executor_decode();
    let options = safe_dispatcher.parse_options_to_array(options).unwrap();
    let res = safe_dispatcher.aggregate_options(options.span(), is_read, v1_eid, native_cap);
    assert_panic_with_error(res, errors::err_unsupported_option_lz_read());
}

#[test]
#[feature("safe_dispatcher")]
fn test_aggregate_options_with_unsupported_option_lz_compose() {
    let options = serialize_executor_options(
        array![
            ExecutorOptionBytes {
                option_type: OPTION_TYPE_LZCOMPOSE,
                option: serialize_lz_compose_option(1, 100, Option::Some(50)),
            },
        ],
    );

    // It's not allowed to have lz compose when v1_eid is true
    let v1_eid = true;
    let is_read = false;
    let native_cap = 0;

    let ExecutorDecodeMock { safe_dispatcher, .. } = deploy_executor_decode();
    let options = safe_dispatcher.parse_options_to_array(options).unwrap();
    let res = safe_dispatcher.aggregate_options(options.span(), is_read, v1_eid, native_cap);
    assert_panic_with_error(res, errors::err_unsupported_option_lz_compose());
}

#[test]
#[feature("safe_dispatcher")]
fn test_aggregate_options_with_unsupported_option_native_drop() {
    let options = serialize_executor_options(
        array![
            ExecutorOptionBytes {
                option_type: OPTION_TYPE_NATIVE_DROP,
                option: serialize_native_drop_option(100, 12345_u256.into()),
            },
        ],
    );

    // It's not allowed to have native drop when is read is true
    let is_read = true;
    let v1_eid = false;
    let native_cap = 0;

    let ExecutorDecodeMock { safe_dispatcher, .. } = deploy_executor_decode();
    let options = safe_dispatcher.parse_options_to_array(options).unwrap();
    let res = safe_dispatcher.aggregate_options(options.span(), is_read, v1_eid, native_cap);
    assert_panic_with_error(res, errors::err_unsupported_option_native_drop());
}

#[test]
#[feature("safe_dispatcher")]
fn test_aggregate_options_with_unsupported_option_lz_receive() {
    let options = serialize_executor_options(
        array![
            ExecutorOptionBytes {
                option_type: OPTION_TYPE_LZRECEIVE,
                option: serialize_lz_receive_option(100, Option::Some(50)),
            },
        ],
    );

    // It's not allowed to have lz receive when is read is true
    let is_read = true;
    let v1_eid = false;
    let native_cap = 0;

    let ExecutorDecodeMock { safe_dispatcher, .. } = deploy_executor_decode();
    let options = safe_dispatcher.parse_options_to_array(options).unwrap();
    let res = safe_dispatcher.aggregate_options(options.span(), is_read, v1_eid, native_cap);
    assert_panic_with_error(res, errors::err_unsupported_option_lz_receive());
}

#[test]
#[feature("safe_dispatcher")]
fn test_parse_options_to_array_with_malformed_options() {
    let ExecutorDecodeMock { safe_dispatcher, .. } = deploy_executor_decode();

    // Case 1: zero size
    let mut opt_zero_size = Default::default();
    opt_zero_size.append_u8(1); // worker id
    opt_zero_size.append_u16(0); // invalid size
    let res1 = safe_dispatcher.parse_options_to_array(opt_zero_size);
    assert_panic_with_error(res1, errors::err_malformed_options());

    // Case 2: non-zero size but truncated type/payload (size=1 but missing 1 byte after length)
    let mut opt_truncated = Default::default();
    opt_truncated.append_u8(1); // worker id
    opt_truncated.append_u16(1); // claims one byte remains (the type)
    let res2 = safe_dispatcher.parse_options_to_array(opt_truncated);
    assert_panic_with_error(res2, errors::err_malformed_options());
}

#[test]
#[feature("safe_dispatcher")]
fn test_aggregate_options_with_zero_calldata_size() {
    let lz_read_gas = 100;
    let lz_read_size = 0;
    let lz_read_value = 50;
    let options = serialize_executor_options(
        array![
            ExecutorOptionBytes {
                option_type: OPTION_TYPE_LZREAD,
                option: serialize_lz_read_option(
                    lz_read_gas, lz_read_size, Option::Some(lz_read_value),
                ),
            },
        ],
    );

    let is_read = true;
    let v1_eid = false;
    let native_cap = lz_read_value;

    let ExecutorDecodeMock { safe_dispatcher, .. } = deploy_executor_decode();
    let options = safe_dispatcher.parse_options_to_array(options).unwrap();
    let res = safe_dispatcher.aggregate_options(options.span(), is_read, v1_eid, native_cap);
    assert_panic_with_error(res, errors::err_zero_calldata_size());
}

#[test]
#[feature("safe_dispatcher")]
fn test_aggregate_options_with_zero_lz_receive_gas() {
    let lz_receive_gas = 0;
    let lz_receive_value = 50;
    let options = serialize_executor_options(
        array![
            ExecutorOptionBytes {
                option_type: OPTION_TYPE_LZRECEIVE,
                option: serialize_lz_receive_option(lz_receive_gas, Option::Some(lz_receive_value)),
            },
        ],
    );

    let is_read = false;
    let v1_eid = false;
    let native_cap = lz_receive_value;

    let ExecutorDecodeMock { safe_dispatcher, .. } = deploy_executor_decode();
    let options = safe_dispatcher.parse_options_to_array(options).unwrap();
    let res = safe_dispatcher.aggregate_options(options.span(), is_read, v1_eid, native_cap);
    assert_panic_with_error(res, errors::err_zero_lz_receive_gas());
}


#[test]
#[feature("safe_dispatcher")]
fn test_aggregate_options_with_native_amount_exceeds_cap() {
    let lz_receive_gas = 100;
    let lz_receive_value = 50;
    let options = serialize_executor_options(
        array![
            ExecutorOptionBytes {
                option_type: OPTION_TYPE_LZRECEIVE,
                option: serialize_lz_receive_option(lz_receive_gas, Option::Some(lz_receive_value)),
            },
        ],
    );

    // native cap is less than lz receive value
    let native_cap = lz_receive_value - 1;
    let is_read = false;
    let v1_eid = false;

    let ExecutorDecodeMock { safe_dispatcher, .. } = deploy_executor_decode();
    let options = safe_dispatcher.parse_options_to_array(options).unwrap();
    let res = safe_dispatcher.aggregate_options(options.span(), is_read, v1_eid, native_cap);
    assert_panic_with_error(res, errors::err_native_amount_exceeds_cap());
}

#[test]
fn test_aggregate_options_with_is_read_true() {
    let read_gas = 100;
    let read_size = 200;
    let read_value = 50;
    let options = serialize_executor_options(
        array![
            ExecutorOptionBytes {
                option_type: OPTION_TYPE_LZREAD,
                option: serialize_lz_read_option(read_gas, read_size, Option::Some(read_value)),
            },
        ],
    );

    let native_cap = read_value;
    let is_read = true;
    let v1_eid = false;

    let ExecutorDecodeMock { dispatcher, .. } = deploy_executor_decode();
    let options = dispatcher.parse_options_to_array(options);
    let res = dispatcher.aggregate_options(options.span(), is_read, v1_eid, native_cap);

    assert(res.total_value == read_value, 'invalid total_value');
    assert(res.total_gas == read_gas, 'invalid total_gas');
    assert(res.lz_receive_gas == read_gas, 'invalid lz_receive_gas');
    assert(res.num_lz_compose == 0, 'invalid num_lz_compose');
    assert(!res.ordered, 'invalid ordered');
    assert(res.calldata_size == read_size, 'invalid calldata_size');
}

#[test]
fn test_aggregate_options_with_is_read_false() {
    let lz_receive_gas = 100;
    let lz_receive_value = 50;
    let native_drop_amount = 100;
    let native_drop_receiver = 12345_u256;
    let lz_compose_index = 1;
    let lz_compose_gas = 100;
    let lz_compose_value = 50;

    let options = serialize_executor_options(
        array![
            ExecutorOptionBytes {
                option_type: OPTION_TYPE_LZRECEIVE,
                option: serialize_lz_receive_option(lz_receive_gas, Option::Some(lz_receive_value)),
            },
            ExecutorOptionBytes {
                option_type: OPTION_TYPE_NATIVE_DROP,
                option: serialize_native_drop_option(
                    native_drop_amount, native_drop_receiver.into(),
                ),
            },
            ExecutorOptionBytes {
                option_type: OPTION_TYPE_LZCOMPOSE,
                option: serialize_lz_compose_option(
                    lz_compose_index, lz_compose_gas, Option::Some(lz_compose_value),
                ),
            },
            ExecutorOptionBytes {
                option_type: OPTION_TYPE_ORDERED_EXECUTION, option: Default::default(),
            },
        ],
    );

    let expected_total_value = lz_receive_value + native_drop_amount + lz_compose_value;
    let expected_total_gas = lz_receive_gas + lz_compose_gas;
    let expected_lz_receive_gas = lz_receive_gas;
    let expected_num_lz_compose = 1;
    let expected_ordered = true;
    let expected_calldata_size = 0;

    // native cap is equal to total value
    let native_cap = expected_total_value;
    let is_read = false;
    let v1_eid = false;

    let ExecutorDecodeMock { dispatcher, .. } = deploy_executor_decode();
    let options = dispatcher.parse_options_to_array(options);
    let res = dispatcher.aggregate_options(options.span(), is_read, v1_eid, native_cap);

    assert(res.total_value == expected_total_value, 'invalid total_value');
    assert(res.total_gas == expected_total_gas, 'invalid total_gas');
    assert(res.lz_receive_gas == expected_lz_receive_gas, 'invalid lz_receive_gas');
    assert(res.num_lz_compose == expected_num_lz_compose, 'invalid num_lz_compose');
    assert(res.ordered == expected_ordered, 'invalid ordered');
    assert(res.calldata_size == expected_calldata_size, 'invalid calldata_size');
}

#[test]
#[feature("safe_dispatcher")]
fn test_parse_options_to_array_no_options() {
    let ExecutorDecodeMock { safe_dispatcher, .. } = deploy_executor_decode();
    let options = serialize_executor_options(array![]);
    let res = safe_dispatcher.parse_options_to_array(options);
    assert_panic_with_error(res, errors::err_no_options());
}

#[test]
fn test_read_lz_receive_option_len_32() {
    let expected_gas = 100;
    let expected_value = 50;
    let correct_option = serialize_lz_receive_option(expected_gas, Option::Some(expected_value));

    let offset = 0;
    let len = 32;

    let ExecutorDecodeMock { dispatcher, .. } = deploy_executor_decode();
    let res = dispatcher.read_lz_receive_option(correct_option, offset, len);

    assert(res.gas == expected_gas, 'invalid gas');
    assert(res.value == expected_value, 'invalid value');
}

#[test]
fn test_read_lz_receive_option_len_16() {
    let expected_gas = 100;
    let expected_value = 0;
    let correct_option = serialize_lz_receive_option(expected_gas, Option::None);

    let offset = 0;
    let len = 16;

    let ExecutorDecodeMock { dispatcher, .. } = deploy_executor_decode();
    let res = dispatcher.read_lz_receive_option(correct_option, offset, len);

    assert(res.gas == expected_gas, 'invalid gas');
    assert(res.value == expected_value, 'invalid value');
}

#[test]
#[feature("safe_dispatcher")]
fn test_read_native_drop_option_with_wrong_length() {
    let offset = 0;
    let wrong_length = 49;
    let correct_option = serialize_native_drop_option(100, 12345_u256.into());

    let ExecutorDecodeMock { safe_dispatcher, .. } = deploy_executor_decode();
    let res = safe_dispatcher.read_native_drop_option(correct_option, offset, wrong_length);
    assert_panic_with_error(res, errors::err_invalid_native_drop_option());
}

#[test]
fn test_read_native_drop_option_len_48() {
    let expected_amount = 100;
    let expected_receiver: Bytes32 = 12345_u256.into();
    let correct_option = serialize_native_drop_option(expected_amount, expected_receiver);

    let offset = 0;
    let len = 48;

    let ExecutorDecodeMock { dispatcher, .. } = deploy_executor_decode();
    let res = dispatcher.read_native_drop_option(correct_option, offset, len);

    assert(res.amount == expected_amount, 'invalid amount');
    assert(res.receiver == expected_receiver, 'invalid receiver');
}

#[test]
#[feature("safe_dispatcher")]
fn test_read_lz_compose_option_with_wrong_length() {
    let offset = 0;
    let wrong_length = 19;
    let correct_option = serialize_lz_compose_option(1, 100, Option::Some(50));

    let ExecutorDecodeMock { safe_dispatcher, .. } = deploy_executor_decode();
    let res = safe_dispatcher.read_lz_compose_option(correct_option, offset, wrong_length);
    assert_panic_with_error(res, errors::err_invalid_lz_compose_option());
}

#[test]
fn test_read_lz_compose_option_with_expected_value() {
    let expected_index = 1;
    let expected_gas = 100;
    let expected_value = 50;
    let correct_option = serialize_lz_compose_option(
        expected_index, expected_gas, Option::Some(expected_value),
    );

    let offset = 0;
    let len = correct_option.len();

    let ExecutorDecodeMock { dispatcher, .. } = deploy_executor_decode();
    let res = dispatcher.read_lz_compose_option(correct_option, offset, len);

    assert(res.index == expected_index, 'invalid index');
    assert(res.gas == expected_gas, 'invalid gas');
    assert(res.value == expected_value, 'invalid value');
}

#[test]
fn test_read_lz_compose_option_without_expected_value_zero() {
    let expected_index = 1;
    let expected_gas = 100;
    let expected_value = 0;
    let correct_option = serialize_lz_compose_option(expected_index, expected_gas, Option::None);

    let offset = 0;
    let len = 18;

    let ExecutorDecodeMock { dispatcher, .. } = deploy_executor_decode();
    let res = dispatcher.read_lz_compose_option(correct_option, offset, len);

    assert(res.index == expected_index, 'invalid index');
    assert(res.gas == expected_gas, 'invalid gas');
    assert(res.value == expected_value, 'invalid value');
}

#[test]
fn test_read_lz_read_option_len_20() {
    let expected_gas = 100;
    let expected_size = 200;
    let expected_value = 0;
    let correct_option = serialize_lz_read_option(expected_gas, expected_size, Option::None);

    let offset = 0;
    let len = 20;

    let ExecutorDecodeMock { dispatcher, .. } = deploy_executor_decode();
    let res = dispatcher.read_lz_read_option(correct_option, offset, len);

    assert(res.gas == expected_gas, 'invalid gas');
    assert(res.size == expected_size, 'invalid size');
    assert(res.value == expected_value, 'invalid value');
}

#[test]
fn test_read_lz_read_option_len_36() {
    let expected_gas = 100;
    let expected_size = 200;
    let expected_value = 50;
    let correct_option = serialize_lz_read_option(
        expected_gas, expected_size, Option::Some(expected_value),
    );

    let offset = 0;
    let len = 36;

    let ExecutorDecodeMock { dispatcher, .. } = deploy_executor_decode();
    let res = dispatcher.read_lz_read_option(correct_option, offset, len);

    assert(res.gas == expected_gas, 'invalid gas');
    assert(res.size == expected_size, 'invalid size');
    assert(res.value == expected_value, 'invalid value');
}

#[test]
#[feature("safe_dispatcher")]
fn test_read_lz_read_option_with_wrong_length() {
    // correctly built read option
    let offset = 0;
    let wrong_length = 21;
    let correct_option = serialize_lz_read_option(100, 200, Option::Some(50));

    let ExecutorDecodeMock { safe_dispatcher, .. } = deploy_executor_decode();
    let res = safe_dispatcher.read_lz_read_option(correct_option, offset, wrong_length);
    assert_panic_with_error(res, errors::err_invalid_lz_read_option());
}
