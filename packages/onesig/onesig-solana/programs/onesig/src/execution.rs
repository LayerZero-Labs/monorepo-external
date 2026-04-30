use anchor_lang::{
    prelude::*, solana_program::program::invoke_signed, system_program::ID as SYSTEM_PROGRAM_ID,
    Discriminator,
};

use crate::{
    constants::ONE_SIG_SEED,
    errors::OneSigError,
    state::{MerkleRootState, OneSigState},
    types::{
        Hash, OneSigAccountMeta, OneSigInstruction, OneSigTransaction, VerifyMerkleRootParams,
    },
    validation::merkle::MerkleValidator,
    ID,
};

/// Resolves the merkle root for execution: either by verifying signatures against the
/// caller-supplied `VerifyMerkleRootParams`, or by reading a pre-verified `MerkleRootState`
/// PDA. This mirrors the two-path behavior of `execute_transaction` and is shared by
/// both `execute_transaction` and `signer_execute_transaction`.
pub fn resolve_merkle_root(
    one_sig_state: &Account<OneSigState>,
    merkle_root_state: Option<&Account<MerkleRootState>>,
    merkle_root_verification: Option<&VerifyMerkleRootParams>,
) -> Result<Hash> {
    let root = if let Some(VerifyMerkleRootParams { merkle_root, expiry, signatures }) =
        merkle_root_verification
    {
        // Case 1: Direct verification with merkle root parameters
        MerkleValidator::verify_merkle_root(
            one_sig_state,
            merkle_root,
            *expiry,
            signatures.as_ref(),
            Clock::get()?.unix_timestamp,
        )?;
        *merkle_root
    } else {
        // Case 2: Two-step verification, using pre-verified merkle root state
        require!(merkle_root_state.is_some(), OneSigError::MissingMerkleRootState);
        merkle_root_state.unwrap().merkle_root
    };
    Ok(root)
}

/// Builds the OneSigInstruction from the transaction using the remaining accounts
/// 1. Calculates the start and end indices for accounts
/// 2. Extracts the relevant accounts
/// 3. Creates an instruction with the program ID from the first account
/// 4. Adds the remaining accounts as instruction accounts
/// 5. Returns the OneSigInstruction
pub fn build_instruction(
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
pub fn execute_instruction(
    one_sig_signer: &AccountInfo,
    one_sig_state: &Account<OneSigState>,
    remaining_accounts: &[AccountInfo],
    instruction: OneSigInstruction,
) -> Result<()> {
    let balance_before = one_sig_signer.lamports();

    let (solana_ix, value) = instruction.into();

    // Block re-entry into either execute path.
    if solana_ix.program_id == ID {
        let exec_disc = crate::instruction::ExecuteTransaction::DISCRIMINATOR;
        let signer_exec_disc = crate::instruction::SignerExecuteTransaction::DISCRIMINATOR;
        require!(
            !solana_ix.data.starts_with(exec_disc) && !solana_ix.data.starts_with(signer_exec_disc),
            OneSigError::Reentrancy
        );
    }

    // Execute the instruction with the PDA's signature
    invoke_signed(
        &solana_ix,
        &remaining_accounts[1..], // Skip program_id
        &[&[ONE_SIG_SEED, one_sig_state.key().as_ref(), &[one_sig_state.bump]]],
    )?;

    // Verify balance change is within limits
    let balance_after = one_sig_signer.lamports();
    require!(balance_before <= balance_after + value, OneSigError::ExcessiveBalanceDeduction);

    // Verify account after execution to ensure:
    // 1. The one_sig_signer account is still owned by the system program
    // 2. The one_sig_signer account is not allocated
    require!(one_sig_signer.owner.key() == SYSTEM_PROGRAM_ID, OneSigError::InvalidSignerOwner);
    require!(one_sig_signer.data_is_empty(), OneSigError::NonEmptySignerData);

    Ok(())
}
