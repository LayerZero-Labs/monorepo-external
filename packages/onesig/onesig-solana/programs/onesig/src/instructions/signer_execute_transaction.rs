use anchor_lang::prelude::*;

use crate::{
    constants::{MERKLE_ROOT_SEED, ONE_SIG_SEED},
    errors::OneSigError,
    events::TransactionExecuted,
    execution::{build_instruction, execute_instruction, resolve_merkle_root},
    state::{MerkleRootState, OneSigState},
    types::SignerExecuteTransactionParams,
    validation::{merkle::MerkleValidator, signature::SignatureValidator},
};

#[event_cpi]
#[derive(Accounts)]
pub struct SignerExecuteTransaction<'info> {
    /// The `delegate` from the signer-as-executor spec: the native account
    /// the off-chain signer bound as the intended submitter in the
    /// `SignerExecutionAuthorization`. The `Signer` constraint enforces
    /// `submitter == delegate`.
    pub delegate: Signer<'info>,
    /// CHECK: This is the same PDA used in invoke_signed when executing transactions.
    /// It signs on behalf of the program in signer_execute_transaction.
    #[account(seeds = [ONE_SIG_SEED, one_sig_state.key().as_ref()], bump = one_sig_state.bump)]
    pub one_sig_signer: AccountInfo<'info>,
    #[account(mut)]
    pub one_sig_state: Account<'info, OneSigState>,
    #[account(
        seeds = [MERKLE_ROOT_SEED, one_sig_state.key().as_ref(), merkle_root_state.merkle_root.as_ref()],
        bump = merkle_root_state.bump,
        constraint = merkle_root_state.expiry >= Clock::get()?.unix_timestamp @OneSigError::ExpiredMerkleRoot,
        constraint = merkle_root_state.seed == one_sig_state.seed @OneSigError::SeedMismatch,
    )]
    pub merkle_root_state: Option<Account<'info, MerkleRootState>>,
}

impl SignerExecuteTransaction<'_> {
    /// "Signer-as-executor" path: a registered secp256k1 signer off-chain authorizes the
    /// submitter (`delegate`) to land a specific leaf via a `SignerExecutionAuthorization`.
    ///
    /// Flow:
    /// 1. Resolve merkle root (direct or pre-verified).
    /// 2. Encode the leaf and verify the merkle proof.
    /// 3. If `executor_required`: run `verify_signer_execution_proof` with digest bound to
    ///    `delegate.key()`. Skipped in permissionless mode.
    /// 4. Execute, increment nonce, emit event.
    pub fn apply(
        ctx: &mut Context<SignerExecuteTransaction>,
        params: &SignerExecuteTransactionParams,
    ) -> Result<()> {
        let SignerExecuteTransactionParams {
            transaction,
            merkle_root_verification,
            signature,
            expiry,
        } = params;

        // Verify merkle root and get the root hash
        let merkle_root = resolve_merkle_root(
            &ctx.accounts.one_sig_state,
            ctx.accounts.merkle_root_state.as_ref(),
            merkle_root_verification.as_ref(),
        )?;

        // Get current nonce (needed for leaf encoding)
        let nonce = ctx.accounts.one_sig_state.nonce;

        // Build the OneSigInstruction from the transaction
        let instruction =
            build_instruction(&ctx.accounts.one_sig_signer, transaction, ctx.remaining_accounts);

        // Encode the transaction leaf and verify against the Merkle proof
        let leaf = MerkleValidator::encode_leaf(
            &ctx.accounts.one_sig_state.key(),
            ctx.accounts.one_sig_state.one_sig_id,
            nonce,
            &instruction,
        )?;
        MerkleValidator::verify_merkle_proof(&merkle_root, &transaction.proof, &leaf)?;

        // Signer-execution-proof gate: only when executor_required. In permissionless mode
        // both the signature and expiry fields are accepted but not verified.
        if ctx.accounts.one_sig_state.executors.executor_required {
            SignatureValidator::verify_signer_execution_proof(
                &leaf,
                &merkle_root,
                ctx.accounts.delegate.key(),
                *expiry,
                &ctx.accounts.one_sig_state.multisig.signers,
                signature,
            )?;
        }

        // Execute the verified OneSigInstruction
        execute_instruction(
            &ctx.accounts.one_sig_signer,
            &ctx.accounts.one_sig_state,
            ctx.remaining_accounts,
            instruction,
        )?;

        // Reload the state account to ensure it's updated after execution
        ctx.accounts.one_sig_state.reload()?;

        // Increment nonce for replay protection.
        ctx.accounts.one_sig_state.nonce = nonce + 1;

        // Emit successful transaction event (shared with execute_transaction; observers
        // disambiguate via the top-level instruction discriminator).
        emit_cpi!(TransactionExecuted {
            one_sig_account: ctx.accounts.one_sig_state.key(),
            merkle_root,
            nonce,
        });
        Ok(())
    }
}
