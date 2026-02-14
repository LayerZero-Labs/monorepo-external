use starknet::ContractAddress;

#[derive(Drop, starknet::Event)]
pub struct IncrementSent {
    #[key]
    pub sender: ContractAddress,
    #[key]
    pub dst_eid: u32,
    pub increment_type: u8,
}

#[derive(Drop, starknet::Event)]
pub struct IncrementReceived {
    #[key]
    pub src_eid: u32,
    pub old_value: u256,
    pub new_value: u256,
    pub increment_type: u8,
    pub value: u256,
}
