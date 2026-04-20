//! Mintable trait - the interface the OFT uses to mint tokens on credit (receive).

use soroban_sdk::{contractclient, Address, Env};

/// The mint interface for OFT MintBurn operations.
///
/// A contract that implements `mint` (e.g. SAC Manager or a token wrapper) is used
/// for crediting; the OFT calls the token (SAC) directly for burn on debit.
#[contractclient(name = "MintableClient")]
pub trait Mintable {
    /// Mints `amount` tokens to `to`. The `operator` address is the caller (e.g. OFT)
    /// requesting the mint, for use by SAC wrappers that enforce authorization.
    fn mint(env: &Env, to: &Address, amount: i128, operator: &Address);
}
