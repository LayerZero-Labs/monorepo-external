use starknet::ContractAddress;

// the default is u256 default = 0
#[derive(Drop, Serde, Default, Copy, Debug, PartialEq, Hash, starknet::Store)]
pub struct Bytes32 {
    pub value: u256,
}

pub impl ContractAddressIntoBytes32 of Into<ContractAddress, Bytes32> {
    fn into(self: ContractAddress) -> Bytes32 {
        let contract_address_felt: felt252 = self.into();
        Bytes32 { value: contract_address_felt.into() }
    }
}

pub impl Bytes32TryIntoContractAddress of TryInto<Bytes32, ContractAddress> {
    fn try_into(self: Bytes32) -> Option<ContractAddress> {
        let bytes32_felt: felt252 = self.value.try_into()?;
        bytes32_felt.try_into()
    }
}

pub impl Bytes32IntoU256 of Into<Bytes32, u256> {
    fn into(self: Bytes32) -> u256 {
        self.value
    }
}

pub impl U256IntoBytes32 of Into<u256, Bytes32> {
    fn into(self: u256) -> Bytes32 {
        Bytes32 { value: self }
    }
}
