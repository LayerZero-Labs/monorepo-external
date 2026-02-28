use anchor_lang::{
    prelude::*, solana_program::program::invoke_signed, system_program::ID as SYSTEM_PROGRAM_ID,
    Discriminator,
};

use crate::{
    constants::{MERKLE_ROOT_SEED, ONE_SIG_SEED},
    errors::OneSigError,
    events::TransactionExecuted,
    state::{MerkleRootState, OneSigState},
    types::{
        ExecuteTransactionParams, Hash, OneSigAccountMeta, OneSigInstruction, OneSigTransaction,
        VerifyMerkleRootParams,
    },
    validation::merkle::MerkleValidator,
    ID,
};

#[event_cpi]
#[derive(Accounts)]
pub struct ExecuteTransaction<'info> {
    pub executor: Signer<'info>,
    /// CHECK: This is the same PDA used in invoke_signed when executing transactions.
    /// It signs on behalf of the program in execute_transaction.
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

impl ExecuteTransaction<'_> {
    /// Executes a transaction with a pre-verified merkle root permissionlessly
    ///
    /// Process:
    /// 1. Verify signatures on Merkle root (or check pre-verified merkle root state)
    /// 2. Build and verify the transaction against Merkle proof
    /// 3. Execute the instruction with proper authorization
    /// 4. Increment nonce for replay protection
    /// 5. Emit successful transaction event
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
        // In Solana, the behavior is different:
        // 1. When executor_required is true: Only approved executors can call this instruction
        // 2. When executor_required is false: Anyone can execute (permissionless)
        //
        // Key architectural difference:
        // Solana's signers CANNOT execute transactions directly (unlike EVM signers).
        // This is because Solana transactions use Ed25519 keypairs for signing, while
        // OneSig's multisig signers use Secp256k1 keys (Ethereum-compatible, verified via
        // Secp256k1Program). Signers authorize transaction batches by signing merkle roots
        // off-chain, but execution must be submitted by accounts with Ed25519 keypairs.
        // Therefore, when executor_required is true, only designated executor accounts
        // (with Ed25519 keys) can submit the execute_transaction instruction.
        if ctx.accounts.one_sig_state.executors.executor_required {
            let executor = ctx.accounts.executor.key();
            require!(
                ctx.accounts.one_sig_state.executors.executors.contains(&executor),
                OneSigError::ExecutorRequired
            );
        }
        let ExecuteTransactionParams { transaction, merkle_root_verification } = params;

        // Verify merkle root and get the root hash
        let merkle_root = verify_merkle_root(ctx, merkle_root_verification)?;

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

        // Execute the verified OneSigInstruction
        execute_instruction(ctx, instruction)?;

        // Reload the state account to ensure it's updated after execution
        ctx.accounts.one_sig_state.reload()?;

        // Increment nonce for replay protection. Since the re-entry is limited by a simple
        // self-recursion on Solana, the nonce can be incremented after the execution
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

/// Verifies merkle root either directly or using pre-verified state
fn verify_merkle_root(
    ctx: &Context<ExecuteTransaction>,
    merkle_root_verification: &Option<VerifyMerkleRootParams>,
) -> Result<Hash> {
    let root = if let Some(VerifyMerkleRootParams { merkle_root, expiry, signatures }) =
        merkle_root_verification
    {
        // Case 1: Direct verification with merkle root parameters
        // Verify Merkle root and signatures
        MerkleValidator::verify_merkle_root(
            &ctx.accounts.one_sig_state,
            merkle_root,
            *expiry,
            signatures.as_ref(),
            Clock::get()?.unix_timestamp,
        )?;
        *merkle_root
    } else {
        // Case 2: Two-step verification, using pre-verified merkle root state
        // Require merkle root state account
        require!(ctx.accounts.merkle_root_state.is_some(), OneSigError::MissingMerkleRootState);
        ctx.accounts.merkle_root_state.as_ref().unwrap().merkle_root
    };
    Ok(root)
}

/// Builds the OneSigInstruction from the transaction using the remaining accounts
/// 1. Calculates the start and end indices for accounts
/// 2. Extracts the relevant accounts
/// 3. Creates an instruction with the program ID from the first account
/// 4. Adds the remaining accounts as instruction accounts
/// 5. Returns the OneSigInstruction
fn build_instruction(
    one_sig_signer: &AccountInfo,
    transaction: &OneSigTransaction,
    remaining_accounts: &[AccountInfo],
) -> OneSigInstruction {
    OneSigInstruction {
        program_id: remaining_accounts[0].key(), // The first account is always the program_id
        accounts: remaining_accounts
            .iter()
            .skip(1) // Skip program_id
            .map(|acc| {
                // only the one_sig_signer account can be the signer
                OneSigAccountMeta {
                    pubkey: acc.key(),
                    is_signer: acc.key() == one_sig_signer.key(),
                    is_writable: acc.is_writable,
                }
            })
            .collect(),
        data: transaction.ix_data.clone(),
        value: transaction.value,
    }
}

/// Executes the instruction with PDA authorization and balance checks:
/// 1. Records the balance of the one_sig_signer before execution
/// 2. Invokes the instruction with the PDA's signature
/// 3. Verifies the balance change is within allowed limits
/// 4. Ensures the one_sig_signer account isn't initialized
fn execute_instruction(
    ctx: &Context<ExecuteTransaction>,
    instruction: OneSigInstruction,
) -> Result<()> {
    let balance_before = ctx.accounts.one_sig_signer.lamports();

    // Convert OneSigInstruction to SolanaInstruction
    let (solana_ix, value) = instruction.into();

    // Not allow to re-entry to execute_transaction
    if solana_ix.program_id == ID {
        let discriminator = crate::instruction::ExecuteTransaction::DISCRIMINATOR;
        require!(*discriminator != solana_ix.data[0..discriminator.len()], OneSigError::Reentrancy);
    }

    // Execute the instruction with the PDA's signature
    invoke_signed(
        &solana_ix,
        &ctx.remaining_accounts[1..], // Skip program_id
        &[&[
            ONE_SIG_SEED,
            ctx.accounts.one_sig_state.key().as_ref(),
            &[ctx.accounts.one_sig_state.bump],
        ]],
    )?;

    // Verify balance change is within limits
    let balance_after = ctx.accounts.one_sig_signer.lamports();
    require!(balance_before <= balance_after + value, OneSigError::ExcessiveBalanceDeduction);

    // Verify account after execution to ensure:
    // 1. The one_sig_signer account is still owned by the system program
    // 2. The one_sig_signer account is not allocated
    require!(
        ctx.accounts.one_sig_signer.owner.key() == SYSTEM_PROGRAM_ID,
        OneSigError::InvalidSignerOwner
    );
    require!(ctx.accounts.one_sig_signer.data_is_empty(), OneSigError::NonEmptySignerData);

    Ok(())
}
