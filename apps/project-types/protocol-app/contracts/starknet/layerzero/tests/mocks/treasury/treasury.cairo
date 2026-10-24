//! Mock LayerZero treasury for testing

#[starknet::contract]
pub mod MockTreasury {
    use layerzero::treasury::interfaces::layerzero_treasury::ILayerZeroTreasury;
    use starknet::ContractAddress;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};

    #[storage]
    struct Storage {
        native_fee: u256,
        lz_token_fee: Option<u256>,
    }

    #[constructor]
    fn constructor(ref self: ContractState, native_fee: u256) {
        self.native_fee.write(native_fee);
    }

    #[abi(embed_v0)]
    impl MockTreasuryImpl of ILayerZeroTreasury<ContractState> {
        fn get_fee(
            self: @ContractState,
            sender: ContractAddress,
            dst_eid: u32,
            worker_fee: u256,
            pay_in_lz_token: bool,
        ) -> u256 {
            if pay_in_lz_token {
                self.lz_token_fee.read().expect('LZ token fee')
            } else {
                self.native_fee.read()
            }
        }

        fn pay_fee(
            ref self: ContractState,
            sender: ContractAddress,
            dst_eid: u32,
            worker_fee: u256,
            pay_in_lz_token: bool,
        ) -> u256 {
            self.get_fee(sender, dst_eid, worker_fee, pay_in_lz_token)
        }
    }

    // Helper functions for testing
    #[abi(embed_v0)]
    impl MockTreasuryHelpers of IMockTreasuryHelpers<ContractState> {
        fn get_native_fee(self: @ContractState) -> u256 {
            self.native_fee.read()
        }

        fn set_native_fee(ref self: ContractState, fee: u256) {
            self.native_fee.write(fee);
        }

        fn get_lz_token_fee(self: @ContractState) -> Option<u256> {
            self.lz_token_fee.read()
        }

        fn set_lz_token_fee(ref self: ContractState, fee: Option<u256>) {
            self.lz_token_fee.write(fee);
        }
    }

    #[starknet::interface]
    pub trait IMockTreasuryHelpers<TContractState> {
        fn get_native_fee(self: @TContractState) -> u256;
        fn set_native_fee(ref self: TContractState, fee: u256);
        fn get_lz_token_fee(self: @TContractState) -> Option<u256>;
        fn set_lz_token_fee(ref self: TContractState, fee: Option<u256>);
    }
}
