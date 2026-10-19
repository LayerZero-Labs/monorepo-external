use anchor_lang::prelude::*;

use crate::{
    constants::{MERKLE_ROOT_SEED, ONE_SIG_SEED},
    errors::OneSigError,
    events::TransactionExecuted,
    execution::{build_instruction, execute_instruction, resolve_merkle_root},
    state::{MerkleRootState, OneSigState},
    types::ExecuteTransactionParams,
    validation::merkle::MerkleValidator,
};

#[event_cpi]
#[derive(Accounts)]
pub struct ExecuteTransaction<'info> {
    pub executor: Signer<'info>,
    /// CHECK: This is the same PDA used in invoke_signed when executing transactions.
    /// It signs on behalf of the program in execute_transaction.
    #[account(seeds = [ONE_SIG_SEED, one_sig_state.key().as_ref()], bump = one_sig_state.bump)]
    pub one_sig_signer: UncheckedAccount<'info>,
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

impl ExecuteTransaction<'_> {
    /// Executes a transaction whose leaf is proven against a signed merkle root.
    ///
    /// The root is resolved one of two ways: inline (signatures verified in this call) or from a
    /// pre-verified `MerkleRootState` PDA. Execution is permissionless unless `executor_required`
    /// is set, in which case `executor` must be an approved executor.
    pub fn apply(
        ctx: &mut Context<ExecuteTransaction>,
        params: &ExecuteTransactionParams,
    ) -> Result<()> {
        // NOTE: Executor validation - Key difference from EVM implementation
        //
        // In EVM (OneSig.sol), when executor_required is true, transactions can be executed by:
        // 1. An approved executor, OR
        // 2. One of the multisig signers (who can sign transactions AND execute them)
        // 3. When executor_required is false, anyone can execute (permissionless)
        //
        // In Solana, this instruction supports option 1 and 3 only. A signer wishing to
        // self-submit uses `signer_execute_transaction` (see signer_execute_transaction.rs).
        if ctx.accounts.one_sig_state.executors.executor_required {
            let executor = ctx.accounts.executor.key();
            require!(
                ctx.accounts.one_sig_state.executors.executors.contains(&executor),
                OneSigError::ExecutorRequired
            );
        }
        let ExecuteTransactionParams { transaction, merkle_root_verification } = params;

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
            build_instruction(&ctx.accounts.one_sig_signer, transaction, ctx.remaining_accounts)?;

        // Encode the transaction leaf and verify against the Merkle proof
        let leaf = MerkleValidator::encode_leaf(
            &ctx.accounts.one_sig_state.key(),
            ctx.accounts.one_sig_state.one_sig_id,
            nonce,
            &instruction,
        )?;
        MerkleValidator::verify_merkle_proof(&merkle_root, &transaction.proof, &leaf)?;

        // Execute the verified OneSigInstruction
        execute_instruction(
            &ctx.accounts.one_sig_signer,
            &ctx.accounts.one_sig_state,
            ctx.remaining_accounts,
            instruction,
        )?;

        // Bump the nonce for replay protection: reload to see any state the executed instruction
        // mutated, reject a mutated nonce, then increment.
        ctx.accounts.one_sig_state.reload()?;
        require!(
            ctx.accounts.one_sig_state.nonce == nonce,
            OneSigError::NonceMutatedDuringExecution
        );
        ctx.accounts.one_sig_state.nonce = nonce + 1;

        // Emit successful transaction event
        emit_cpi!(TransactionExecuted {
            one_sig_account: ctx.accounts.one_sig_state.key(),
            merkle_root,
            nonce,
        });
        Ok(())
    }
}
