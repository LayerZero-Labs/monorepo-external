//! LockUnlock type implementation for OFT.
//!
//! This OFT type locks tokens in the contract on debit (send) and unlocks
//! tokens from the contract on credit (receive).
//! Operates directly on the token via standard SEP-41 `transfer`.

use oft_core::OFTCore;
use soroban_sdk::{token::TokenClient, Address, Env};

/// Debit tokens using LockUnlock OFT type (locks tokens in contract).
///
/// # Parameters
/// * `env` - The Soroban environment
/// * `token` - Address of the token
/// * `sender` - Address of the token sender
/// * `amount_ld` - Amount to debit in local decimals
/// * `min_amount_ld` - Minimum amount that must be received (for slippage protection)
/// * `dst_eid` - Destination endpoint ID
///
/// # Returns
/// * `amount_sent_ld` - The amount sent in local decimals
/// * `amount_received_ld` - The amount received in local decimals on the remote
pub fn debit<T: OFTCore>(
    env: &Env,
    token: &Address,
    sender: &Address,
    amount_ld: i128,
    min_amount_ld: i128,
    dst_eid: u32,
) -> (i128, i128) {
    let (amount_sent_ld, amount_received_ld) = T::__debit_view(env, amount_ld, min_amount_ld, dst_eid);
    TokenClient::new(env, token).transfer(sender, env.current_contract_address(), &amount_received_ld);
    (amount_sent_ld, amount_received_ld)
}

/// Credit tokens using LockUnlock OFT type (unlocks tokens from contract).
///
/// # Parameters
/// * `env` - The Soroban environment
/// * `token` - Address of the token
/// * `to` - Address of the token recipient
/// * `amount_ld` - Amount to credit in local decimals
/// * `_src_eid` - Source endpoint ID (unused)
///
/// # Returns
/// The amount credited
pub fn credit<T: OFTCore>(env: &Env, token: &Address, to: &Address, amount_ld: i128, _src_eid: u32) -> i128 {
    TokenClient::new(env, token).transfer(&env.current_contract_address(), to, &amount_ld);
    amount_ld
}
