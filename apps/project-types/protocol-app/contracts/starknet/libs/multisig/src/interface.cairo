use starknet::EthAddress;
use starknet::secp256_trait::Signature;

/// Multisig
/// Multisig contract interface for a multisig component
/// Designed to be used by contracts requiring multi-signature verification with ECDSA verification
/// Addresses are held as u256 integers but are converted as Bytes from the `alexandria_bytes`
/// crate to allow better byte manipulation
#[starknet::interface]
pub trait IMultisig<TContractState> {
    /// Allows the Multisig contract to update the signature threshold
    /// This function can only be called by the MultiSig contract itself
    ///
    /// # Arguments
    ///
    /// * `threshold`: The new threshold for the Multisig contract
    fn set_threshold(ref self: TContractState, threshold: u32);

    /// Gets the current signature threshold for the multisig contract
    ///
    /// # Returns
    ///
    /// * The current threshold as a u32
    fn get_threshold(self: @TContractState) -> u32;

    /// Adds or removes a signer from this Multisig
    /// Only callable via the Multisig contract itself
    ///
    /// # Arguments
    ///
    /// * `signer`: The address of the signer to add or remove
    /// * `active`: True to add signer, false to remove signer
    fn set_signer(ref self: TContractState, signer: EthAddress, active: bool);

    /// Checks if a given address is in the set of signers.
    ///
    /// # Arguments
    ///
    /// * `signer`: The address to check
    ///
    /// # Returns
    ///
    /// True if the address is in the set of signers, false otherwise.
    fn is_signer(self: @TContractState, signer: EthAddress) -> bool;

    /// Returns the list of all active signers
    ///
    /// # Returns
    /// An array of addresses representing the current set of signers.
    fn get_signers(self: @TContractState) -> Array<EthAddress>;

    /// Returns the total number of active signers.
    ///
    /// # Returns
    ///
    /// The total number of signers currently active.
    fn total_signers(self: @TContractState) -> u32;

    /// Verifies a list of signatures against a digest
    ///
    /// # Arguments
    ///
    /// * `digest`: The digest to verify the signatures against
    /// * `signatures`: The list of signatures to verify
    fn verify_signatures(self: @TContractState, digest: u256, signatures: Span<Signature>);

    /// Returns the maximum threshold for the multisig
    ///
    /// # Returns
    ///
    /// The maximum threshold for the multisig
    fn get_max_threshold(self: @TContractState) -> u32;
}
