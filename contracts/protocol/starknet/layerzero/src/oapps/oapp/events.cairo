use lz_utils::bytes::Bytes32;

#[derive(Drop, starknet::Event)]
pub struct PeerSet {
    #[key]
    pub eid: u32,
    #[key]
    pub peer: Bytes32,
}
