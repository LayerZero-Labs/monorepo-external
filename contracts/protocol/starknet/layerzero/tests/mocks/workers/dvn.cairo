//! Mock DVN worker contract for testing

#[starknet::contract]
pub mod MockDVN {
    use layerzero::workers::base::structs::QuoteParams;
    use layerzero::workers::dvn::interface::IDvn;
    use layerzero::workers::dvn::structs::{DstConfig, ExecuteParam, SetDstConfigParams};
    use layerzero::workers::interface::ILayerZeroWorker;
    use lz_utils::bytes::Bytes32;
    use lz_utils::error::assert_with_byte_array;
    use starknet::ClassHash;
    use starknet::account::Call;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};

    pub(crate) const DST_CONFIG: DstConfig = DstConfig {
        gas: 100000, multiplier_bps: 10000, floor_margin_usd: 0,
    };
    pub(crate) const DST_CONFIG_2: DstConfig = DstConfig {
        gas: 200000, multiplier_bps: 20000, floor_margin_usd: 0,
    };

    #[storage]
    struct Storage {
        quote_result: u256,
        should_fail: bool,
    }

    #[constructor]
    fn constructor(ref self: ContractState, quote_result: u256) {
        self.quote_result.write(quote_result);
        self.should_fail.write(false);
    }

    #[abi(embed_v0)]
    impl MockDVNImpl of IDvn<ContractState> {
        /// Mock implementation - do nothing
        fn set_dst_config(ref self: ContractState, params: Array<SetDstConfigParams>) {}

        /// Mock implementation - do nothing
        fn execute(ref self: ContractState, params: Array<ExecuteParam>) {}

        /// Mock implementation - do nothing
        fn upgrade(ref self: ContractState, new_class_hash: ClassHash) {}

        /// Mock implementation - do nothing
        fn upgrade_and_call(
            ref self: ContractState,
            new_class_hash: ClassHash,
            selector: felt252,
            calldata: Span<felt252>,
        ) -> Span<felt252> {
            array![].span()
        }

        /// Mock implementation - do nothing
        fn quorum_change_admin(ref self: ContractState, param: ExecuteParam) {}

        /// Mock implementation - return default config
        fn get_dst_config(self: @ContractState, dst_eid: u32) -> DstConfig {
            if dst_eid == 0 {
                DST_CONFIG
            } else {
                DST_CONFIG_2
            }
        }

        /// Mock implementation - return dummy hash
        fn hash_call_data(
            self: @ContractState, vid: u32, call_data: Call, expiration: u256,
        ) -> Bytes32 {
            Bytes32 { value: 'mock_hash'.into() }
        }

        fn get_vid(self: @ContractState) -> u32 {
            0
        }

        fn get_used_hash(self: @ContractState, hash: Bytes32) -> bool {
            false
        }
    }

    #[abi(embed_v0)]
    impl MockLayerZeroWorkerImpl of ILayerZeroWorker<ContractState> {
        fn assign_job(ref self: ContractState, params: QuoteParams) -> u256 {
            assert_with_byte_array(!self.should_fail.read(), "MockDVN: quote failed");
            self.quote_result.read()
        }

        fn quote(self: @ContractState, params: QuoteParams) -> u256 {
            assert_with_byte_array(!self.should_fail.read(), "MockDVN: quote failed");
            self.quote_result.read()
        }
    }

    /// Helper functions for testing
    #[abi(embed_v0)]
    impl MockDVNHelpers of IMockDVNHelpers<ContractState> {
        fn set_quote_result(ref self: ContractState, quote_result: u256) {
            self.quote_result.write(quote_result);
        }

        fn get_quote_result(self: @ContractState) -> u256 {
            self.quote_result.read()
        }

        fn set_should_fail(ref self: ContractState, should_fail: bool) {
            self.should_fail.write(should_fail);
        }

        fn get_should_fail(self: @ContractState) -> bool {
            self.should_fail.read()
        }
    }

    #[starknet::interface]
    pub trait IMockDVNHelpers<TContractState> {
        fn set_quote_result(ref self: TContractState, quote_result: u256);
        fn get_quote_result(self: @TContractState) -> u256;
        fn set_should_fail(ref self: TContractState, should_fail: bool);
        fn get_should_fail(self: @TContractState) -> bool;
    }
}
