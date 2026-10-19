//! Common constants

use core::num::traits::Pow;
use starknet::ContractAddress;

/// Contract address for the ETH ERC20 token on Starknet
pub const ETH_CONTRACT_ADDRESS: ContractAddress =
    0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7
    .try_into()
    .unwrap();

pub const ZERO_ADDRESS: ContractAddress = 0.try_into().unwrap();
pub const DEAD_ADDRESS: ContractAddress = 0xdead.try_into().unwrap();

/// Basis points denominator (10,000 bps = 100%)
/// Used for percentage calculations where 1 bp = 0.01%
pub const BPS_DENOMINATOR: u256 = 10000;

/// Native decimals rate
/// - STRK has 18 decimals
/// - https://docs.starknet.io/guides/becoming-a-validator/stake/
/// NOTE: You might need to change this if you want to deploy and EndpointV2Alt with a different
/// native token
pub const NATIVE_DECIMALS_RATE: u256 = 10_u256.pow(18);

/// Maximum v1 EID
pub const MAX_V1_EID: u32 = 30_000;
