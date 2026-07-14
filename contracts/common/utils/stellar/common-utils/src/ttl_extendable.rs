//! TtlExtendable trait for manual instance TTL extension.
//!
//! This module provides the `TtlExtendable` trait which allows external callers
//! to extend a contract's instance storage TTL, keeping the contract alive.

/// Trait for contracts that support manual instance TTL extension.
///
/// This trait provides a public contract function to extend the instance storage TTL,
/// allowing external callers to keep the contract alive by paying for TTL extension.
///
/// Uses `#[soroban_sdk::contracttrait]` directly (not `#[common_macros::contract_trait]`)
/// because auto TTL extension would be redundant for a trait whose purpose is manual
/// TTL control.
#[soroban_sdk::contracttrait]
pub trait TtlExtendable {
    /// Extends the instance TTL.
    ///
    /// # Arguments
    ///
    /// * `threshold` - The threshold to extend the TTL (if current TTL is below this, extend).
    /// * `extend_to` - The TTL to extend to.
    fn extend_instance_ttl(env: &soroban_sdk::Env, threshold: u32, extend_to: u32) {
        env.storage().instance().extend_ttl(threshold, extend_to);
    }
}
