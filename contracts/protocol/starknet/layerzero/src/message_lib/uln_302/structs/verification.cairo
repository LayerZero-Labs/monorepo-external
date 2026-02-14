//! ULN verification struct

#[derive(Debug, Drop, Serde, starknet::Store, Default, PartialEq)]
pub struct Verification {
    pub submitted: bool,
    pub confirmations: u64,
}
