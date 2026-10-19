//! Mock ExecutorDecode interface for testing

use core::array::Span;
use core::byte_array::ByteArray;
use layerzero::workers::executor::options::{ExecutorOptionsAggregated, PriceFeedParams};
use layerzero::workers::executor::structs::{
    ExecutorOption, LzComposeOption, LzReadOption, LzReceiveOption, NativeDropOption,
};

#[starknet::interface]
pub trait IMockExecutorDecode<TContractState> {
    fn decode_executor_options(
        self: @TContractState,
        is_read: bool,
        v1_eid: bool,
        lz_receive_base_gas: u256,
        lz_compose_base_gas: u256,
        native_cap: u128,
        options: ByteArray,
    ) -> PriceFeedParams;

    fn apply_premium_to_gas(
        self: @TContractState,
        fee: u256,
        bps: u16,
        default_bps: u16,
        margin_usd: u128,
        native_price_usd: u128,
    ) -> u256;

    fn convert_and_apply_premium_to_value(
        self: @TContractState, value: u256, ratio: u128, denom: u128, bps: u16, default_bps: u16,
    ) -> u256;

    fn parse_options_to_array(
        self: @TContractState, options_bytes: ByteArray,
    ) -> Array<ExecutorOption>;

    fn aggregate_options(
        self: @TContractState,
        options_span: Span<ExecutorOption>,
        is_read: bool,
        v1_eid: bool,
        native_cap: u128,
    ) -> ExecutorOptionsAggregated;

    fn read_lz_receive_option(
        self: @TContractState, b: ByteArray, offset: usize, len: usize,
    ) -> LzReceiveOption;
    fn read_native_drop_option(
        self: @TContractState, b: ByteArray, offset: usize, len: usize,
    ) -> NativeDropOption;
    fn read_lz_compose_option(
        self: @TContractState, b: ByteArray, offset: usize, len: usize,
    ) -> LzComposeOption;
    fn read_lz_read_option(
        self: @TContractState, b: ByteArray, offset: usize, len: usize,
    ) -> LzReadOption;
}
