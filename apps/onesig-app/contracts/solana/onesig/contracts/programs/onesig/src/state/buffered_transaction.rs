use anchor_lang::prelude::*;

use crate::{
    errors::OneSigError,
    types::{Hash, OneSigCall, OneSigTransaction},
};

#[account]
#[derive(InitSpace)]
pub struct BufferedTransaction {
    // Created this buffered transaction, is the only key allowed to append calls, and
    // receives the rent refund on close. Also a PDA seed, together with the merkle root
    // and target nonce (namespacing only; content is bound to root and nonce
    // cryptographically at execution).
    pub authority: Pubkey,
    // The complete Borsh serialization of `Vec<OneSigCall>`, uploaded in byte chunks so
    // a payload larger than one Solana transaction can still be assembled. Deserialized
    // (and thereby integrity-checked) into `OneSigTransaction` at execution.
    // INIT_SPACE counts only the 4-byte Vec header; the bytes are added at init/realloc time.
    #[max_len(0)]
    pub calls_data: Vec<u8>,
    // Merkle proof that this transaction's leaf belongs to the signed root. INIT_SPACE
    // counts only the 4-byte Vec header; proof elements are added at init time.
    #[max_len(0)]
    pub proof: Vec<Hash>,
}

// Deserializes the buffered transaction. Modeled as a type conversion, not a getter, to make
// explicit that it decodes bytes rather than reading calls straight from the PDA: it fails on
// truncated or trailing bytes, so a partially buffered transaction can never execute.
impl TryFrom<&BufferedTransaction> for OneSigTransaction {
    type Error = anchor_lang::error::Error;

    fn try_from(buffered_transaction: &BufferedTransaction) -> Result<Self> {
        let calls: Vec<OneSigCall> =
            AnchorDeserialize::try_from_slice(&buffered_transaction.calls_data)
                .map_err(|_| error!(OneSigError::InvalidBufferedTransactionCallsData))?;

        Ok(Self { calls, proof: buffered_transaction.proof.clone() })
    }
}
