use crate::errors::OFTError;
use soroban_sdk::{address_payload::AddressPayload, assert_with_error, Address, BytesN, Env};
use utils::option_ext::OptionExt;

// =====================================================
// OFT Helper Functions
// =====================================================

/// Converts from shared decimals (SD) to local decimals (LD).
pub fn to_ld(amount_sd: u64, conversion_rate: i128) -> i128 {
    (amount_sd as i128) * conversion_rate
}

/// Converts from local decimals (LD) to shared decimals (SD).
pub fn to_sd(env: &Env, amount_ld: i128, conversion_rate: i128) -> u64 {
    let amount_sd = amount_ld / conversion_rate;
    assert_with_error!(env, amount_sd <= u64::MAX as i128, OFTError::Overflow);
    amount_sd as u64
}

/// Removes dust from amount based on decimal conversion rate.
pub fn remove_dust(amount_ld: i128, conversion_rate: i128) -> i128 {
    (amount_ld / conversion_rate) * conversion_rate
}

// =====================================================
// Address Helper Functions
// =====================================================

/// Extracts the 32-byte payload from an address.
///
/// This function extracts the raw 32-byte payload from a Stellar address,
/// which can be either a contract ID hash or an Ed25519 public key.
/// This payload can later be resolved back to an address using `resolve_address`.
///
/// # Arguments
/// * `address` - The Stellar address to extract the payload from
///
/// # Returns
/// A 32-byte payload (contract ID hash or Ed25519 public key)
pub fn address_payload(env: &Env, address: &Address) -> BytesN<32> {
    match address.to_payload().unwrap_or_panic(env, OFTError::InvalidAddress) {
        AddressPayload::ContractIdHash(payload) => payload,
        AddressPayload::AccountIdPublicKeyEd25519(payload) => payload,
    }
}

/// Resolves a 32-byte payload back to a Stellar address.
///
/// Cross-chain messages only carry 32-byte addresses, but Stellar has two address types
/// (contract C-addresses and account G-addresses) that share the same 32-byte payload.
/// This function disambiguates by checking contract existence first, then falling back
/// to a G-address.
///
/// Sending tokens to a non-existent contract address is unlikely in practice — the sender
/// on the source chain is expected to deploy the destination contract beforehand.
///
/// # Arguments
/// * `env` - The Soroban environment
/// * `bytes32` - The 32-byte payload to resolve
///
/// # Returns
/// The resolved address (either contract or account address)
pub fn resolve_address(env: &Env, bytes32: &BytesN<32>) -> Address {
    let contract_address = Address::from_payload(env, AddressPayload::ContractIdHash(bytes32.clone()));
    if contract_address.exists() {
        contract_address
    } else {
        Address::from_payload(env, AddressPayload::AccountIdPublicKeyEd25519(bytes32.clone()))
    }
}
