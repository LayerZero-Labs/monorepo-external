//! MintBurn type implementation for OFT.
//!
//! This OFT type burns tokens on debit (send) and mints tokens on credit (receive).
//! On debit, tokens are burned from the sender via the token's SEP-41 `burn`.
//! On credit, tokens are minted to the recipient via a separate Mintable contract.

use crate::interfaces::MintableClient;
use oft_core::OFTCore;
use soroban_sdk::{token::TokenClient, Address, Env};

/// Debit tokens using MintBurn OFT type (burns tokens from sender).
///
/// # Parameters
/// * `env` - The Soroban environment
/// * `token` - Address of the token (SAC) to burn from
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
    TokenClient::new(env, token).burn(sender, &amount_received_ld);
    (amount_sent_ld, amount_received_ld)
}

/// Credit tokens using MintBurn OFT type (mints tokens to recipient).
///
/// # Parameters
/// * `env` - The Soroban environment
/// * `mintable` - Address of the contract responsible for minting tokens (e.g. SAC wrapper)
/// * `to` - Address of the token recipient
/// * `amount_ld` - Amount to credit in local decimals
/// * `_src_eid` - Source endpoint ID (unused)
///
/// # Returns
/// The amount credited
pub fn credit<T: OFTCore>(env: &Env, mintable: &Address, to: &Address, amount_ld: i128, _src_eid: u32) -> i128 {
    MintableClient::new(env, mintable).mint(to, &amount_ld, &env.current_contract_address());
    amount_ld
}
