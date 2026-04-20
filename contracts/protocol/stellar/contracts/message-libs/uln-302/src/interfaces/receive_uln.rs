use crate::types::{OAppUlnConfig, SetDefaultUlnConfigParam, UlnConfig};
use soroban_sdk::{contractclient, Address, Bytes, BytesN, Env, Vec};

/// Interface for ULN302 receive library functions.
///
/// Handles DVN verification and message commitment on the receiving chain.
#[contractclient(name = "ReceiveUln302Client")]
pub trait IReceiveUln302 {
    // ============================================================================================
    // Verification Functions
    // ============================================================================================

    /// Called by a DVN to verify a message with a specific number of confirmations.
    ///
    /// # Arguments
    /// * `dvn` - The DVN address
    /// * `packet_header` - The raw packet header bytes
    /// * `payload_hash` - The hash of the message payload
    /// * `confirmations` - The number of block confirmations the DVN has observed
    fn verify(env: &Env, dvn: &Address, packet_header: &Bytes, payload_hash: &BytesN<32>, confirmations: u64);

    /// Returns the block confirmations a DVN has reported for a message.
    ///
    /// # Arguments
    /// * `dvn` - The DVN address
    /// * `header_hash` - The hash of the packet header
    /// * `payload_hash` - The hash of the message payload
    fn confirmations(env: &Env, dvn: &Address, header_hash: &BytesN<32>, payload_hash: &BytesN<32>) -> Option<u64>;

    /// Checks if a message has been verified by enough DVNs to be committed.
    ///
    /// Evaluates whether all required DVNs and the threshold of optional DVNs
    /// have verified the message with sufficient block confirmations.
    ///
    /// # Arguments
    /// * `packet_header` - The raw packet header bytes
    /// * `payload_hash` - The hash of the message payload
    ///
    /// # Returns
    /// True if the message has been verified by enough DVNs to be committed, false otherwise
    fn verifiable(env: &Env, packet_header: &Bytes, payload_hash: &BytesN<32>) -> bool;

    /// Permissionless function to commit a verified message to the endpoint after sufficient DVN verification.
    ///
    /// Checks that all required DVNs and the optional DVN threshold have verified
    /// the message, then calls `verify` on the endpoint to make the message executable.
    ///
    /// # Arguments
    /// * `packet_header` - The raw packet header bytes
    /// * `payload_hash` - The hash of the message payload
    fn commit_verification(env: &Env, packet_header: &Bytes, payload_hash: &BytesN<32>);

    // ============================================================================================
    // Configuration Functions
    // ============================================================================================

    /// Sets default receive ULN configurations for multiple source endpoints.
    ///
    /// # Arguments
    /// * `params` - A vector of `SetDefaultUlnConfigParam`, each containing a source EID and its ULN config
    fn set_default_receive_uln_configs(env: &Env, params: &Vec<SetDefaultUlnConfigParam>);

    /// Returns the default receive ULN configuration for a source endpoint.
    ///
    /// # Arguments
    /// * `src_eid` - The source endpoint ID
    fn default_receive_uln_config(env: &Env, src_eid: u32) -> Option<UlnConfig>;

    /// Returns the OApp-specific receive ULN configuration for a specific source endpoint.
    ///
    /// # Arguments
    /// * `receiver` - The receiver OApp address
    /// * `src_eid` - The source endpoint ID
    fn oapp_receive_uln_config(env: &Env, receiver: &Address, src_eid: u32) -> Option<OAppUlnConfig>;

    /// Gets the effective receive ULN configuration.
    ///
    /// Merges the OApp-specific config with the default config. OApp settings take precedence.
    ///
    /// # Arguments
    /// * `receiver` - The receiver OApp address
    /// * `src_eid` - The source endpoint ID
    ///
    /// # Returns
    /// The effective receive ULN configuration
    ///
    /// # Panics
    /// Panics if the default receive ULN configuration is not set for the source endpoint.
    fn effective_receive_uln_config(env: &Env, receiver: &Address, src_eid: u32) -> UlnConfig;
}
