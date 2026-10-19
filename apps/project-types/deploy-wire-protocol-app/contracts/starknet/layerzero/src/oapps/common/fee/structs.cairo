#[derive(Drop, Serde, Default, starknet::Store, PartialEq, Debug)]
pub struct FeeConfig {
    pub fee_bps: u16,
    pub enabled: bool,
}
