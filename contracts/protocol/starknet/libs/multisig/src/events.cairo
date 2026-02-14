use starknet::EthAddress;

#[derive(Drop, Debug, PartialEq, starknet::Event)]
pub struct ThresholdSet {
    pub threshold: u32,
}

#[derive(Drop, Debug, PartialEq, starknet::Event)]
pub struct SignerSet {
    #[key]
    pub signer: EthAddress,
    pub active: bool,
}
