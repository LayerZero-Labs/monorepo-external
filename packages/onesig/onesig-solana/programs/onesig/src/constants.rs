use anchor_lang::solana_program::keccak::HASH_BYTES;
use hex_literal::hex;

/// Current program version
pub const VERSION: &str = "0.0.1";

/// PDA seed for OneSig account derivation
pub const ONE_SIG_SEED: &[u8] = b"OneSig";

/// PDA seed for Merkle tree account derivation
pub const MERKLE_ROOT_SEED: &[u8] = b"MerkleRoot";

/// EIP-191 prefix for EIP-712 style digests
pub const EIP191_PREFIX_FOR_EIP712: [u8; 2] = [0x19, 0x01];

/// Maximum number of signers (20) for a OneSig account.
/// Solana limits account size to 10KB, which could theoretically support up to 159 signers,
/// but we limit to 20 for 2 reasons:
/// 1. Aligns with practical governance needs for most DAOs and multisig wallets
/// 2. The threshold is limited to 13 by Solana's transaction size constraints when including
///    multiple signatures, so additional signers beyond 20 provide minimal security benefits
pub const SIGNERS_MAX_LEN: usize = 20;

/// Solana account size limit is 10KB, so we limit the number of executors to 277
/// to avoid hitting the limit
pub const EXECUTORS_MAX_LEN: usize = 277;

/// The maximum number of threshold is 13 for the Solana transaction size limit
pub const MAX_THRESHOLD: u8 = 13;

/// Size of raw signature (64 bytes + 1 recovery byte)
pub const SIGNATURE_BYTES_LEN: usize = 65;

/// The version of the Merkle tree leaf encoding
pub const MERKLE_LEAF_ENCODING_VERSION: [u8; 1] = [1];

/// keccak::hash(b"SignMerkleRoot(bytes32 seed,bytes32 merkleRoot,uint256 expiry)").as_ref()
pub const SIGN_MERKLE_ROOT_TYPE_HASH: [u8; HASH_BYTES] =
    hex!("642ed5d2b77bc7ccb98e10da4c02d7cd8231228da4222a9f88a80c15545074ed");

/// Pre-calculated domain separator for EIP-712 signatures, hashed by following data:
/// - EIP-191 prefix for EIP-712 style digests
/// - EIP-712 domain separator type-hash
/// - Contract name: "OneSig"
/// - Contract version: "0.0.1"
/// - Chain ID: 1 (Ethereum Mainnet)
/// - Verifying contract address: 0xdEaD
pub const DOMAIN_SEPARATOR: [u8; HASH_BYTES] =
    hex!("94c28989170eb4dc31359174b9115c116a8fafa67b5adacc570ca583eb96d657");
