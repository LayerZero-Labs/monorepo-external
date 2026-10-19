//! Mock LayerZero token fee library for testing

#[starknet::interface]
pub trait IMockLzTokenFeeLibAssertion<TContractState> {
    fn assert_payment_count(self: @TContractState, count: felt252);
}

#[starknet::contract]
pub mod MockLzTokenFeeLib {
    use layerzero::treasury::interfaces::lz_token_fee_lib::ILzTokenFeeLib;
    use starknet::ContractAddress;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use super::IMockLzTokenFeeLibAssertion;

    #[storage]
    struct Storage {
        fee: u256,
        payment_count: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, fee: u256) {
        self.fee.write(fee);
    }

    #[abi(embed_v0)]
    impl LzTokenFeeLibImpl of ILzTokenFeeLib<ContractState> {
        fn get_fee(
            self: @ContractState,
            sender: ContractAddress,
            dst_eid: u32,
            worker_fee: u256,
            native_treasury_fee: u256,
        ) -> u256 {
            self.fee.read()
        }

        fn pay_fee(
            ref self: ContractState,
            sender: ContractAddress,
            dst_eid: u32,
            worker_fee: u256,
            native_treasury_fee: u256,
        ) -> u256 {
            self.payment_count.write(self.payment_count.read() + 1);

            self.fee.read()
        }
    }

    #[abi(embed_v0)]
    impl MockLzTokenFeeLibStateImpl of IMockLzTokenFeeLibAssertion<ContractState> {
        fn assert_payment_count(self: @ContractState, count: felt252) {
            assert!(self.payment_count.read() == count);
        }
    }
}
