#[derive(Drop, starknet::Event)]
pub struct FeeBpsSet {
    pub dst_eid: u32,
    pub fee_bps: u16,
    pub enabled: bool,
}

#[derive(Drop, starknet::Event)]
pub struct DefaultFeeBpsSet {
    pub fee_bps: u16,
}
