#[derive(Drop, starknet::Event)]
pub struct BasisPointsUpdated {
    pub old_bp: u256,
    pub new_bp: u256,
}
