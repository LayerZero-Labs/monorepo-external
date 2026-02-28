use anchor_lang::{
    prelude::{
        borsh::{BorshDeserialize, BorshSerialize},
        *,
    },
    solana_program::{
        instruction::{AccountMeta, Instruction},
        keccak::{Hash as SolanaHash, HASH_BYTES},
        secp256k1_recover::{
            Secp256k1Pubkey as SolanaSecp256k1Pubkey, SECP256K1_PUBLIC_KEY_LENGTH,
        },
    },
};

use crate::constants::SIGNATURE_BYTES_LEN;

pub const ADDRESS_LEN: usize = 20;

#[derive(
    Clone,
    Copy,
    Eq,
    PartialEq,
    Ord,
    PartialOrd,
    Hash,
    InitSpace,
    AnchorSerialize,
    AnchorDeserialize,
    Default,
)]
pub struct Address(pub [u8; ADDRESS_LEN]);

impl Address {
    pub fn to_bytes(self) -> [u8; ADDRESS_LEN] {
        self.0
    }
}

impl From<Secp256k1Pubkey> for Address {
    fn from(pubkey: Secp256k1Pubkey) -> Self {
        let pubkey_bytes = pubkey.to_bytes();
        let hash = anchor_lang::solana_program::keccak::hash(&pubkey_bytes);
        let mut address_bytes = [0u8; ADDRESS_LEN];
        address_bytes.copy_from_slice(&hash.to_bytes()[12..]);
        Self(address_bytes)
    }
}

impl TryFrom<Vec<u8>> for Address {
    type Error = std::array::TryFromSliceError;

    fn try_from(slice: Vec<u8>) -> std::result::Result<Self, Self::Error> {
        let array: &[u8; ADDRESS_LEN] = slice.as_slice().try_into()?;
        Ok(Address(*array))
    }
}

#[derive(
    Clone, Copy, Eq, PartialEq, Ord, PartialOrd, Hash, InitSpace, AnchorSerialize, AnchorDeserialize,
)]
pub struct Secp256k1Pubkey(pub [u8; SECP256K1_PUBLIC_KEY_LENGTH]);

impl Secp256k1Pubkey {
    pub fn new(pubkey_vec: &[u8]) -> Self {
        Self(
            <[u8; SECP256K1_PUBLIC_KEY_LENGTH]>::try_from(<&[u8]>::clone(&pubkey_vec))
                .expect("Slice must be the same length as a Pubkey"),
        )
    }

    pub fn to_bytes(self) -> [u8; SECP256K1_PUBLIC_KEY_LENGTH] {
        self.0
    }
}

impl Default for Secp256k1Pubkey {
    fn default() -> Self {
        Self([0; SECP256K1_PUBLIC_KEY_LENGTH])
    }
}

impl From<SolanaSecp256k1Pubkey> for Secp256k1Pubkey {
    fn from(pubkey: SolanaSecp256k1Pubkey) -> Self {
        Self(pubkey.0)
    }
}

impl TryFrom<Vec<u8>> for Secp256k1Pubkey {
    type Error = std::array::TryFromSliceError;

    fn try_from(slice: Vec<u8>) -> std::result::Result<Self, Self::Error> {
        let array: &[u8; SECP256K1_PUBLIC_KEY_LENGTH] = slice.as_slice().try_into()?;
        Ok(Secp256k1Pubkey(*array))
    }
}

#[derive(
    Clone, Copy, Eq, PartialEq, Ord, PartialOrd, Hash, InitSpace, AnchorSerialize, AnchorDeserialize,
)]
pub struct Signature(pub [u8; SIGNATURE_BYTES_LEN]);

impl Default for Signature {
    fn default() -> Self {
        Self([0u8; SIGNATURE_BYTES_LEN])
    }
}

impl Signature {
    pub fn to_bytes(self) -> [u8; SIGNATURE_BYTES_LEN] {
        self.0
    }

    pub fn split_recovery_id(&self) -> (&u8, &[u8]) {
        self.0.split_last().unwrap()
    }
}

impl TryFrom<&[u8]> for Signature {
    type Error = anchor_lang::error::Error;

    fn try_from(slice: &[u8]) -> std::result::Result<Self, Self::Error> {
        let array: &[u8; SIGNATURE_BYTES_LEN] = slice
            .try_into()
            .map_err(|_| crate::errors::OneSigError::InvalidSignatureFormat)?;
        Ok(Signature(*array))
    }
}

#[derive(
    Clone, Copy, Eq, PartialEq, Ord, PartialOrd, Hash, InitSpace, AnchorSerialize, AnchorDeserialize,
)]
pub struct Hash(pub [u8; HASH_BYTES]);

impl AsRef<[u8]> for Hash {
    fn as_ref(&self) -> &[u8] {
        &self.0[..]
    }
}

impl From<SolanaHash> for Hash {
    fn from(hash: SolanaHash) -> Self {
        Self(hash.0)
    }
}

impl TryFrom<Vec<u8>> for Hash {
    type Error = std::array::TryFromSliceError;

    fn try_from(slice: Vec<u8>) -> std::result::Result<Self, Self::Error> {
        let array: &[u8; HASH_BYTES] = slice.as_slice().try_into()?;
        Ok(Hash(*array))
    }
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct InitOneSigParams {
    pub one_sig_id: u64,
    pub seed: Hash,
    pub threshold: u8,
    pub signers: Vec<Address>,
    pub executors: Vec<Pubkey>,
    pub executor_required: bool,
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub enum SetConfigParams {
    AddSigner(Address),
    RemoveSigner(Address),
    SetThreshold(u8),
    SetSeed(Hash),
    AddExecutor(Pubkey),
    RemoveExecutor(Pubkey),
    SetExecutorRequired(bool),
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ExecuteTransactionParams {
    // Transaction with calls and Merkle proof
    pub transaction: OneSigTransaction,
    // Optional merkle root verification parameters
    // If None, we'll check for a pre-verified merkle root state
    pub merkle_root_verification: Option<VerifyMerkleRootParams>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct VerifyMerkleRootParams {
    // Expected Merkle root
    pub merkle_root: Hash,
    // Root validity timestamp
    pub expiry: i64,
    // Concatenated signatures
    pub signatures: Vec<u8>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OneSigTransaction {
    pub ix_data: Vec<u8>,
    // The maximum amount of SOL that can be spent by the subsequent instruction
    pub value: u64,
    pub proof: Vec<Hash>,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
pub struct OneSigAccountMeta {
    pub pubkey: Pubkey,
    pub is_signer: bool,
    pub is_writable: bool,
}

impl From<OneSigAccountMeta> for AccountMeta {
    fn from(account_meta: OneSigAccountMeta) -> Self {
        AccountMeta {
            pubkey: account_meta.pubkey,
            is_signer: account_meta.is_signer,
            is_writable: account_meta.is_writable,
        }
    }
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
pub struct OneSigInstruction {
    pub program_id: Pubkey,
    pub accounts: Vec<OneSigAccountMeta>,
    pub data: Vec<u8>,
    pub value: u64,
}

impl From<OneSigInstruction> for (Instruction, u64) {
    fn from(instruction: OneSigInstruction) -> Self {
        (
            Instruction {
                program_id: instruction.program_id,
                accounts: instruction.accounts.into_iter().map(|a| a.into()).collect(),
                data: instruction.data,
            },
            instruction.value,
        )
    }
}
