use starknet::EthAddress;

/// Mock interface to test EnumerableSet functionality
#[starknet::interface]
pub trait IMockEnumerableSet<TContractState> {
    fn add(ref self: TContractState, address: EthAddress) -> bool;
    fn remove(ref self: TContractState, address: EthAddress) -> bool;
    fn contains(self: @TContractState, address: EthAddress) -> bool;
    fn length(self: @TContractState) -> u32;
    fn values(self: @TContractState) -> Array<EthAddress>;
    fn is_empty(self: @TContractState) -> bool;
    fn clear(ref self: TContractState);
    fn at(self: @TContractState, index: u32) -> EthAddress;
}

/// Mock contract for testing the EnumerableSet struct
#[starknet::contract]
pub mod MockEnumerableSet {
    use enumerable_set::{EnumerableSet, EnumerableSetTrait};
    use starknet::EthAddress;

    #[storage]
    struct Storage {
        pub enumerable_set: EnumerableSet<EthAddress>,
    }

    #[abi(embed_v0)]
    impl MockEnumerableSetImpl of super::IMockEnumerableSet<ContractState> {
        fn add(ref self: ContractState, address: EthAddress) -> bool {
            self.enumerable_set.add(address)
        }

        fn remove(ref self: ContractState, address: EthAddress) -> bool {
            self.enumerable_set.remove(address)
        }

        fn contains(self: @ContractState, address: EthAddress) -> bool {
            self.enumerable_set.contains(address)
        }

        fn length(self: @ContractState) -> u32 {
            self.enumerable_set.length()
        }

        fn values(self: @ContractState) -> Array<EthAddress> {
            self.enumerable_set.values()
        }

        fn is_empty(self: @ContractState) -> bool {
            self.enumerable_set.is_empty()
        }

        fn clear(ref self: ContractState) {
            self.enumerable_set.clear()
        }

        fn at(self: @ContractState, index: u32) -> EthAddress {
            self.enumerable_set.at(index)
        }
    }
}
