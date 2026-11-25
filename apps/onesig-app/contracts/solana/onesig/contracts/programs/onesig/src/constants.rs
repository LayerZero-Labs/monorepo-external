use hex_literal::hex;
use solana_keccak_hasher::HASH_BYTES;

/// Current program version
pub const VERSION: &str = "0.0.1";

/// PDA seed for OneSig account derivation
pub const ONE_SIG_SEED: &[u8] = b"OneSig";

/// PDA seed for buffered signatures account derivation
pub const BUFFERED_SIGNATURES_SEED: &[u8] = b"BufferedSignatures";

/// PDA seed for buffered transaction account derivation
pub const BUFFERED_TRANSACTION_SEED: &[u8] = b"BufferedTransaction";

/// EIP-191 prefix for EIP-712 style digests
pub const EIP191_PREFIX_FOR_EIP712: [u8; 2] = [0x19, 0x01];

/// keccak256("SignerExecutionAuthorization(bytes32 leafHash,bytes32 merkleRoot,bytes
/// delegate,uint256 expiry)")
pub const SIGNER_EXECUTION_AUTHORIZATION_TYPE_HASH: [u8; HASH_BYTES] =
    hex!("2ed09255a17ecc5d8fd5128a11480e0f01d23b22eaeb02f4f4acae355e5c428a");

/// Maximum number of signers for a OneSig account.
/// 50 × 20 bytes (Address) = 1 KB in OneSigState — well within account limits.
/// Note: Solana's 1232-byte tx limit caps inline signatures at ~13 (13 × 65 bytes).
/// Thresholds above ~13 must use buffered signatures
/// (init_buffered_signatures + append_buffered_signatures).
pub const SIGNERS_MAX_LEN: usize = 50;

/// Solana account size limit is 10KB, so we limit the number of executors to 277
/// to avoid hitting the limit
pub const EXECUTORS_MAX_LEN: usize = 277;

/// Size of raw signature (64 bytes + 1 recovery byte)
pub const SIGNATURE_BYTES_LEN: usize = 65;

/// Half the secp256k1 curve order (n/2), big-endian. A signature with `s > n/2` is the malleable
/// "high-S" twin of a canonical one; Solana's `secp256k1_recover` accepts both `s` and `n - s`, so
/// we reject high-S here to match EVM's `ECDSA.tryRecover` (low-S only) and stay cross-chain
/// consistent. Value matches OpenZeppelin's `ECDSA` bound.
pub const SECP256K1_HALF_ORDER: [u8; HASH_BYTES] =
    hex!("7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0");

/// The version of the Merkle tree leaf encoding
pub const MERKLE_LEAF_ENCODING_VERSION: [u8; 1] = [1];

/// keccak::hash(b"SignMerkleRoot(bytes32 seed,bytes32 merkleRoot,uint256 expiry)").as_ref()
pub const SIGN_MERKLE_ROOT_TYPE_HASH: [u8; HASH_BYTES] =
    hex!("642ed5d2b77bc7ccb98e10da4c02d7cd8231228da4222a9f88a80c15545074ed");

/// Pre-calculated EIP-712 domain separator, hashed from the following domain fields:
/// - EIP-712 domain separator type-hash
/// - Contract name: "OneSig"
/// - Contract version: "0.0.1"
/// - Chain ID: 1 (Ethereum Mainnet)
/// - Verifying contract address: 0xdEaD
///
/// The EIP-191 `0x1901` prefix is not part of this constant. It is prepended to this separator
/// and the struct hash when constructing each final EIP-712 digest.
pub const DOMAIN_SEPARATOR: [u8; HASH_BYTES] =
    hex!("94c28989170eb4dc31359174b9115c116a8fafa67b5adacc570ca583eb96d657");
