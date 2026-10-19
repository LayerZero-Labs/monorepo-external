//! Mock ExecutorDecode interface for testing

#[starknet::contract]
mod MockExecutorDecode {
    use core::array::Span;
    use core::byte_array::ByteArray;
    use layerzero::workers::common::{
        apply_premium_and_floor_margin, convert_and_apply_premium_to_value,
    };
    use layerzero::workers::executor::options::{
        ExecutorOptionsAggregated, PriceFeedParams, _aggregate_options, _decode_executor_options,
        _parse_options_to_array, _read_lz_compose_option, _read_lz_read_option,
        _read_lz_receive_option, _read_native_drop_option,
    };
    use layerzero::workers::executor::structs::{
        ExecutorOption, LzComposeOption, LzReadOption, LzReceiveOption, NativeDropOption,
    };
    use crate::mocks::workers::executor::decode::interface::IMockExecutorDecode;


    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl MockExecutorDecodeImpl of IMockExecutorDecode<ContractState> {
        fn decode_executor_options(
            self: @ContractState,
            is_read: bool,
            v1_eid: bool,
            lz_receive_base_gas: u256,
            lz_compose_base_gas: u256,
            native_cap: u128,
            options: ByteArray,
        ) -> PriceFeedParams {
            _decode_executor_options(
                is_read, v1_eid, lz_receive_base_gas, lz_compose_base_gas, native_cap, @options,
            )
        }

        fn apply_premium_to_gas(
            self: @ContractState,
            fee: u256,
            bps: u16,
            default_bps: u16,
            margin_usd: u128,
            native_price_usd: u128,
        ) -> u256 {
            apply_premium_and_floor_margin(fee, bps, default_bps, margin_usd, native_price_usd)
        }

        fn convert_and_apply_premium_to_value(
            self: @ContractState, value: u256, ratio: u128, denom: u128, bps: u16, default_bps: u16,
        ) -> u256 {
            convert_and_apply_premium_to_value(value, ratio, denom, bps, default_bps)
        }

        fn parse_options_to_array(
            self: @ContractState, options_bytes: ByteArray,
        ) -> Array<ExecutorOption> {
            _parse_options_to_array(@options_bytes)
        }

        fn aggregate_options(
            self: @ContractState,
            options_span: Span<ExecutorOption>,
            is_read: bool,
            v1_eid: bool,
            native_cap: u128,
        ) -> ExecutorOptionsAggregated {
            _aggregate_options(options_span, is_read, v1_eid, native_cap)
        }

        fn read_lz_receive_option(
            self: @ContractState, b: ByteArray, offset: usize, len: usize,
        ) -> LzReceiveOption {
            _read_lz_receive_option(@b, offset, len)
        }

        fn read_native_drop_option(
            self: @ContractState, b: ByteArray, offset: usize, len: usize,
        ) -> NativeDropOption {
            _read_native_drop_option(@b, offset, len)
        }

        fn read_lz_compose_option(
            self: @ContractState, b: ByteArray, offset: usize, len: usize,
        ) -> LzComposeOption {
            _read_lz_compose_option(@b, offset, len)
        }

        fn read_lz_read_option(
            self: @ContractState, b: ByteArray, offset: usize, len: usize,
        ) -> LzReadOption {
            _read_lz_read_option(@b, offset, len)
        }
    }
}
