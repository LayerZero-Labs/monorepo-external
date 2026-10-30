use starknet::ContractAddress;

#[derive(Drop, Serde, Clone)]
pub struct QuoteParams {
    pub dst_eid: u32,
    pub sender: ContractAddress,
    pub confirmations: u64,
    pub calldata_size: u32,
    pub options: ByteArray,
}
