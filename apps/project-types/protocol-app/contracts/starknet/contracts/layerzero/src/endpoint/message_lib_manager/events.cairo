//! Message lib manager events

use starknet::ContractAddress;

/// Emitted when a new message library is registered.
#[derive(Drop, starknet::Event)]
pub struct LibraryRegistered {
    /// The address of the registered library.
    #[key]
    pub library: ContractAddress,
}

/// Emitted when a send library is set for a specific sender and destination EID.
#[derive(Drop, starknet::Event)]
pub struct SendLibrarySet {
    /// The sender's address.
    #[key]
    pub sender: ContractAddress,
    /// The destination EID.
    #[key]
    pub dst_eid: u32,
    /// The address of the send library.
    #[key]
    pub library: ContractAddress,
}

/// Emitted when a receive library is set for a specific receiver and source EID.
#[derive(Drop, starknet::Event)]
pub struct ReceiveLibrarySet {
    /// The receiver's address.
    #[key]
    pub receiver: ContractAddress,
    /// The source EID.
    #[key]
    pub src_eid: u32,
    /// The address of the receive library.
    #[key]
    pub library: ContractAddress,
}

/// Emitted when a default send library is set for a specific EID.
#[derive(Drop, starknet::Event)]
pub struct DefaultSendLibrarySet {
    /// The EID for which the default send library is set.
    #[key]
    pub eid: u32,
    /// The address of the default send library.
    #[key]
    pub library: ContractAddress,
}

/// Emitted when a default receive library is set for a specific EID.
#[derive(Drop, starknet::Event)]
pub struct DefaultReceiveLibrarySet {
    /// The EID for which the default receive library is set.
    #[key]
    pub eid: u32,
    /// The address of the default receive library.
    #[key]
    pub library: ContractAddress,
}

/// Emitted when a timeout is set for a receive library.
#[derive(Drop, starknet::Event)]
pub struct ReceiveLibraryTimeoutSet {
    /// The OApp's address.
    #[key]
    pub receiver: ContractAddress,
    /// The EID for which the timeout is set.
    #[key]
    pub eid: u32,
    /// The address of the receive library.
    #[key]
    pub library: ContractAddress,
    /// The expiry timestamp for the timeout.
    pub expiry: u64,
}

/// Emitted when a timeout is set for a default receive library.
#[derive(Drop, starknet::Event)]
pub struct DefaultReceiveLibraryTimeoutSet {
    /// The EID for which the timeout is set.
    #[key]
    pub eid: u32,
    /// The address of the default receive library.
    #[key]
    pub library: ContractAddress,
    /// The expiry timestamp for the timeout.
    pub expiry: u64,
}
