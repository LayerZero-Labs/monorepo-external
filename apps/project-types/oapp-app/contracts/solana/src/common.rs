use anchor_lang::{prelude::*, Discriminator};

pub const EXECUTION_CONTEXT_SEED: &[u8] = b"ExecutionContext";
pub const EXECUTION_CONTEXT_VERSION_1: u8 = 1;

/// Execution context data structure that contains metadata for cross-chain execution
/// This provides execution limits and tracking for LayerZero operations
#[derive(InitSpace, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ExecutionContextV1 {
    pub initial_payer_balance: u64,
    /// The maximum total lamports allowed to be used by all instructions in this execution.
    /// This is a hard cap for the sum of lamports consumed by all instructions in the execution
    /// batch.
    pub fee_limit: u64,
}

impl anchor_lang::Discriminator for ExecutionContextV1 {
    // let discriminator_preimage = "account:ExecutionContextV1";
    // let hash = anchor_lang::solana_program::hash::hash(discriminator_preimage.as_bytes());
    const DISCRIMINATOR: &'static [u8] = &[132, 92, 176, 59, 141, 186, 141, 137];
}

impl anchor_lang::AccountDeserialize for ExecutionContextV1 {
    fn try_deserialize(buf: &mut &[u8]) -> anchor_lang::Result<Self> {
        if buf.len() < Self::DISCRIMINATOR.len() {
            return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorNotFound.into());
        }
        let given_disc = &buf[..8];
        if Self::DISCRIMINATOR != given_disc {
            return Err(anchor_lang::error!(
                anchor_lang::error::ErrorCode::AccountDiscriminatorMismatch
            )
            .with_account_name("ExecutionContextV1"));
        }
        Self::try_deserialize_unchecked(buf)
    }

    fn try_deserialize_unchecked(buf: &mut &[u8]) -> anchor_lang::Result<Self> {
        let mut data: &[u8] = &buf[8..];
        anchor_lang::AnchorDeserialize::deserialize(&mut data)
            .map_err(|_| anchor_lang::error::ErrorCode::AccountDidNotDeserialize.into())
    }
}

/// How a planned instruction names an account; the Executor resolves it when building delivery.
///
/// Only `Payer` and `Signer` resolve to signers, so a literal `Address` can never request a
/// signature.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub enum AddressLocator {
    /// A literal account address.
    Address(Pubkey),
    /// The Executor's fee payer.
    Payer,
    /// An additional Executor-provided signer, e.g. the keypair of an account the plan creates.
    /// Equal indices refer to the same key throughout the plan.
    Signer(u8),
    /// The Executor's execution-context PDA (`[EXECUTION_CONTEXT_SEED, payer, context_version]`
    /// under the Executor program), e.g. an [`ExecutionContextV1`].
    Context,
}

impl From<Pubkey> for AddressLocator {
    fn from(key: Pubkey) -> Self {
        Self::Address(key)
    }
}

/// One account of a planned instruction. Signer status comes from the locator, not a flag.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct AccountMetaRef {
    pub pubkey: AddressLocator,
    pub is_writable: bool,
}
