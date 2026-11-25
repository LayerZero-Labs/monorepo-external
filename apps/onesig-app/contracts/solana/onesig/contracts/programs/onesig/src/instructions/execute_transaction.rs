use anchor_lang::{
    prelude::*, solana_program::program::invoke_signed, system_program::ID as SYSTEM_PROGRAM_ID,
    Discriminator,
};

use crate::{
    constants::{BUFFERED_SIGNATURES_SEED, BUFFERED_TRANSACTION_SEED, ONE_SIG_SEED},
    errors::OneSigError,
    events::{BufferedSignaturesClosed, BufferedTransactionClosed, TransactionExecuted},
    state::{BufferedSignatures, BufferedTransaction, OneSigState},
    types::{
        CallAccountRef, Hash, OneSigAccountMeta, OneSigCall, OneSigInstruction, OneSigTransaction,
        SignerAuthorization,
    },
    validation::{merkle::MerkleValidator, signature::SignatureValidator},
    ID,
};

type ResolvedTransaction<'info> = (Vec<OneSigInstruction>, Vec<Vec<AccountInfo<'info>>>, Vec<Hash>);

// See `ExecuteTransaction::apply` for how these combine.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ExecuteTransactionParams {
    // Expected Merkle root.
    pub merkle_root: Hash,
    // Unix-seconds cutoff past which the root is no longer valid. In the EIP-712 preimage it is
    // encoded as a uint256, left-padded with zeros.
    pub expiry: u64,
    // Concatenated inline signatures. None when `buffered_signatures` supplies them instead.
    pub signatures: Option<Vec<u8>>,
    // Per-call references into `remaining_accounts`: `[program_id, ...accounts]`.
    // Each reference preserves the writability signed for that specific call.
    pub call_account_refs: Vec<Vec<CallAccountRef>>,
    // Inline calls to execute; if None, a `buffered_transaction` account must be provided.
    pub transaction: Option<OneSigTransaction>,
    // Checked only when `executor_required` and the executor is not allowlisted; otherwise
    // ignored.
    pub signer_authorization: Option<SignerAuthorization>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(params: ExecuteTransactionParams)]
pub struct ExecuteTransaction<'info> {
    pub executor: Signer<'info>,
    /// CHECK: This is the same PDA used in invoke_signed when executing transactions.
    /// It signs on behalf of the program in execute_transaction.
    #[account(seeds = [ONE_SIG_SEED, one_sig_state.key().as_ref()], bump = one_sig_state.bump)]
    pub one_sig_signer: UncheckedAccount<'info>,

    #[account(mut)]
    pub one_sig_state: Account<'info, OneSigState>,

    // === Optional accounts, supplied per execution mode (see `apply`). ===
    #[account(
        mut,
        seeds = [
            BUFFERED_SIGNATURES_SEED,
            one_sig_state.key().as_ref(),
            params.merkle_root.as_ref(),
            buffered_signatures.authority.as_ref(),
        ],
        bump,
    )]
    pub buffered_signatures: Option<Account<'info, BufferedSignatures>>,

    /// CHECK: Rent refund target for buffered_signatures auto-close; must match its authority.
    #[account(mut)]
    pub buffered_signatures_authority: Option<UncheckedAccount<'info>>,

    // No `close =` here: Anchor still requires the refund account in the tx even when
    // this PDA is not used, so inline executions could not omit both accounts together.
    // We close manually in `maybe_close_buffered_transaction` when the PDA is present.
    #[account(
        mut,
        seeds = [
            BUFFERED_TRANSACTION_SEED,
            one_sig_state.key().as_ref(),
            params.merkle_root.as_ref(),
            &one_sig_state.nonce.to_be_bytes(),
            buffered_transaction.authority.as_ref(),
        ],
        bump,
    )]
    pub buffered_transaction: Option<Account<'info, BufferedTransaction>>,

    /// CHECK: Rent refund target for buffered transaction close; must match its authority.
    #[account(mut)]
    pub buffered_transaction_authority: Option<UncheckedAccount<'info>>,
}

impl<'info> ExecuteTransaction<'info> {
    /// Executes a transaction whose leaf is proven against a signed merkle root.
    ///
    /// Execution is configured by three orthogonal choices:
    ///
    /// 1. Merkle root verification:
    ///    - Inline: provide `merkle_root`, `expiry`, and `signatures`.
    ///    - Buffered signatures: provide `merkle_root` and `expiry` plus a buffered signatures PDA
    ///      created via `init_buffered_signatures`. The PDA's signatures are used for verification,
    ///      so params.signatures must be None (supplying both sources is rejected). If the PDA is
    ///      closable (`nonce > closable_after_nonce`), `buffered_signatures_authority` must be
    ///      provided to receive the rent refund.
    ///
    /// 2. Call data source (mutually exclusive):
    ///    - Inline: provide `transaction` and omit `buffered_transaction`.
    ///    - Buffered: provide `buffered_transaction` and omit `transaction`, after uploading via
    ///      `init_buffered_transaction` / `append_buffered_transaction`. Useful for payloads too
    ///      large for one transaction, or a deliberate upload-then-execute flow.
    ///
    /// 3. Executor authorization:
    ///    - If `executor_required` is set, `executor` must be allowlisted or provide a signer's
    ///      `signer_authorization` for this leaf.
    ///    - If unset, execution is permissionless.
    ///
    /// Common execution shapes, roughly ordered from hottest to most pre-staged:
    ///
    /// | Shape             | Signatures          | Calls    | Use when                   |
    /// | ----------------- | ------------------- | -------- | -------------------------- |
    /// | One-shot          | Inline              | Inline   | Hot path                   |
    /// | Root signatures   | Buffered            | Inline   | Large threshold/signatures |
    /// | Calls pre-staged  | Inline              | Buffered | Large call data            |
    /// | Fully pre-staged  | Buffered            | Buffered | Large signatures and calls |
    pub fn apply(
        ctx: Context<'info, ExecuteTransaction<'info>>,
        params: ExecuteTransactionParams,
    ) -> Result<()> {
        let ExecuteTransactionParams {
            transaction,
            call_account_refs,
            merkle_root,
            expiry,
            signatures,
            signer_authorization,
        } = params;

        // Resolve the execution payload (calls source -> CPI instructions) and its merkle proof.
        let (instructions, instruction_accounts, proof) = ctx.accounts.resolve_transaction(
            transaction,
            &call_account_refs,
            ctx.remaining_accounts,
        )?;

        // Validate the merkle root and leaf against the OneSigState
        ctx.accounts.verify_merkle_root(&merkle_root, expiry, signatures.as_deref())?;
        let nonce = ctx.accounts.one_sig_state.nonce;
        // Encode the transaction leaf and verify against the Merkle proof before any CPI.
        let leaf = MerkleValidator::encode_leaf(
            &ctx.accounts.one_sig_state.key(),
            ctx.accounts.one_sig_state.one_sig_id,
            nonce,
            &instructions,
        )?;
        MerkleValidator::verify_merkle_proof(&merkle_root, &proof, &leaf)?;

        // Verify the executor is authorized to execute this leaf.
        ctx.accounts.verify_executor_authorization(
            &leaf,
            &merkle_root,
            signer_authorization.as_ref(),
        )?;

        ctx.accounts.execute_instructions(instructions, instruction_accounts)?;

        // Bump the nonce once for the whole leaf.
        ctx.accounts.bump_nonce_once(nonce)?;

        // Close the buffered PDAs whose rent can now be reclaimed.
        Self::maybe_close_buffered_signatures(&ctx)?;
        Self::maybe_close_buffered_transaction(&ctx)?;

        // Emit successful transaction event
        emit_cpi!(TransactionExecuted {
            one_sig_account: ctx.accounts.one_sig_state.key(),
            merkle_root,
            nonce,
        });

        // Allocator high-water mark, for profiling builds only.
        //
        // The bump allocator never reclaims, so this is the total allocated by this instruction —
        // the figure that decides how large a heap frame a caller must request. It reports only on
        // runs that SUCCEED: exhausting the heap traps in the VM before reaching here, surfacing as
        // an access violation rather than a program error, so this cannot improve that diagnostic.
        // Use it to measure headroom, not to explain failures.
        #[cfg(all(
            feature = "heap-profiling",
            feature = "custom-heap",
            not(feature = "no-entrypoint"),
            target_os = "solana"
        ))]
        msg!("heap_used={}", crate::allocator::heap_used());

        Ok(())
    }

    /// Verifies the merkle root against the multisig threshold using inline or buffered signatures.
    fn verify_merkle_root(
        &self,
        merkle_root: &Hash,
        expiry: u64,
        signatures: Option<&[u8]>,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp as u64;
        // Signatures come from exactly one source: the buffered PDA or the inline param,
        // never both and never neither.
        let signatures = match (self.buffered_signatures.as_ref(), signatures) {
            (Some(state), None) => state.signatures.as_ref(),
            (None, Some(inline)) => inline,
            _ => return err!(OneSigError::AmbiguousSignaturesSource),
        };

        MerkleValidator::verify_merkle_root(
            &self.one_sig_state,
            merkle_root,
            expiry,
            signatures,
            now,
        )
    }

    /// Resolves the execution payload: selects the calls source (inline `transaction` or the
    /// `buffered_transaction` account), reconstructs each `OneSigCall` into a CPI instruction
    /// against `remaining_accounts`, and returns the instructions together with the leaf's proof.
    ///
    /// `remaining_accounts` is an ordered account table chosen by the SDK/caller. Each
    /// `call_account_refs[i]` maps call `i` into that table as `[program_id, ...accounts]`,
    /// retaining the per-call writability used in the signed leaf.
    ///
    /// The table is typically deduped across all calls for smaller transactions, but deduplication
    /// is not required by this program. Correctness depends on the indices resolving to the
    /// accounts whose metas are encoded in the signed leaf.
    fn resolve_transaction(
        &self,
        transaction: Option<OneSigTransaction>,
        call_account_refs: &[Vec<CallAccountRef>],
        remaining_accounts: &[AccountInfo<'info>],
    ) -> Result<ResolvedTransaction<'info>> {
        let transaction = match (self.buffered_transaction.as_ref(), transaction) {
            (Some(bt), None) => OneSigTransaction::try_from(bt.as_ref())?,
            (None, Some(tx)) => tx,
            _ => return err!(OneSigError::AmbiguousCallsSource),
        };
        let OneSigTransaction { calls, proof } = transaction;

        require!(!calls.is_empty(), OneSigError::EmptyCalls);
        require!(calls.len() == call_account_refs.len(), OneSigError::CallAccountCountMismatch);

        let mut instructions = Vec::with_capacity(calls.len());
        let mut instruction_accounts = Vec::with_capacity(calls.len());

        for (call, account_refs) in calls.into_iter().zip(call_account_refs) {
            let (instruction, accounts) =
                self.resolve_instruction(call, account_refs, remaining_accounts)?;
            instructions.push(instruction);
            instruction_accounts.push(accounts);
        }

        Ok((instructions, instruction_accounts, proof))
    }

    fn resolve_instruction(
        &self,
        call: OneSigCall,
        account_refs: &[CallAccountRef],
        remaining_accounts: &[AccountInfo<'info>],
    ) -> Result<(OneSigInstruction, Vec<AccountInfo<'info>>)> {
        // account_refs is `[program_id, ...instruction_accounts]`.
        let (program_ref, instruction_account_refs) =
            account_refs.split_first().ok_or(error!(OneSigError::MissingProgramId))?;

        let account_at = |index: u8| -> Result<AccountInfo<'info>> {
            let idx = index as usize;
            require!(idx < remaining_accounts.len(), OneSigError::InvalidExecuteParams);
            Ok(remaining_accounts[idx].clone())
        };

        let program_id = account_at(program_ref.index)?.key();
        let one_sig_signer_key = self.one_sig_signer.key();

        let mut metas = Vec::with_capacity(instruction_account_refs.len());
        let mut accounts = Vec::with_capacity(instruction_account_refs.len());
        for account_ref in instruction_account_refs {
            let account_info = account_at(account_ref.index)?;
            let pubkey = account_info.key();
            metas.push(OneSigAccountMeta {
                pubkey,
                is_signer: pubkey == one_sig_signer_key,
                is_writable: account_ref.is_writable,
            });
            accounts.push(account_info);
        }

        Ok((
            OneSigInstruction {
                program_id,
                accounts: metas,
                data: call.ix_data,
                value: call.value,
            },
            accounts,
        ))
    }

    // Enforces the executor gate: when `executor_required` is set, the executor must be
    // allowlisted or carry a signer's execution authorization for this leaf.
    fn verify_executor_authorization(
        &self,
        leaf: &Hash,
        merkle_root: &Hash,
        signer_authorization: Option<&SignerAuthorization>,
    ) -> Result<()> {
        if !self.one_sig_state.executors.executor_required {
            return Ok(());
        }

        let executor = self.executor.key();
        if self.one_sig_state.executors.executors.contains(&executor) {
            return Ok(());
        }

        let authorization = signer_authorization.ok_or(error!(OneSigError::ExecutorRequired))?;
        SignatureValidator::verify_signer_execution_proof(
            leaf,
            merkle_root,
            executor,
            authorization.expiry,
            &self.one_sig_state.multisig.signers,
            &authorization.signature,
        )
    }

    /// Executes all instructions with PDA authorization, enforcing per instruction: the
    /// re-entrancy guard, the per-call value cap on net lamport decrease, and that
    /// `one_sig_signer` stays system-owned and unallocated after each CPI.
    fn execute_instructions(
        &self,
        instructions: Vec<OneSigInstruction>,
        instruction_accounts: Vec<Vec<AccountInfo<'info>>>,
    ) -> Result<()> {
        for (instruction, accounts) in instructions.into_iter().zip(instruction_accounts) {
            let balance_before = self.one_sig_signer.lamports();
            let (solana_ix, value) = instruction.into();

            // Re-entrancy guard: an executed instruction must not call back into the
            // nonce-advancing execute path, or it could replay itself and defeat replay protection.
            // Matching only the program id and discriminator also blocks a different OneSig state.
            if solana_ix.program_id == ID {
                let exec_disc = crate::instruction::ExecuteTransaction::DISCRIMINATOR;
                require!(!solana_ix.data.starts_with(exec_disc), OneSigError::Reentrancy);
            }

            invoke_signed(
                &solana_ix,
                &accounts,
                &[&[ONE_SIG_SEED, self.one_sig_state.key().as_ref(), &[self.one_sig_state.bump]]],
            )?;

            let balance_after = self.one_sig_signer.lamports();
            require!(
                balance_before.saturating_sub(balance_after) <= value,
                OneSigError::ExcessiveBalanceDeduction
            );
            // Verify account after execution to ensure:
            // 1. The one_sig_signer account is still owned by the system program
            // 2. The one_sig_signer account is not allocated
            require!(
                self.one_sig_signer.owner.key() == SYSTEM_PROGRAM_ID,
                OneSigError::InvalidSignerOwner
            );
            require!(self.one_sig_signer.data_is_empty(), OneSigError::NonEmptySignerData);
        }

        Ok(())
    }

    /// Bumps the OneSig nonce once after a whole leaf has executed. Reload first so an inner CPI
    /// cannot mutate the nonce and still let this execution advance it.
    fn bump_nonce_once(&mut self, expected_nonce: u64) -> Result<()> {
        self.one_sig_state.reload()?;
        require!(
            self.one_sig_state.nonce == expected_nonce,
            OneSigError::NonceMutatedDuringExecution
        );
        self.one_sig_state.nonce = expected_nonce + 1;
        Ok(())
    }

    /// Closes the buffered signatures PDA once all leaves in the tree have been executed.
    fn maybe_close_buffered_signatures(
        ctx: &Context<'info, ExecuteTransaction<'info>>,
    ) -> Result<()> {
        let Some(buffered_signatures) = ctx.accounts.buffered_signatures.as_ref() else {
            return Ok(());
        };
        if buffered_signatures.closable_after_nonce >= ctx.accounts.one_sig_state.nonce {
            return Ok(());
        }

        let authority = ctx
            .accounts
            .buffered_signatures_authority
            .as_ref()
            .ok_or(error!(OneSigError::MissingBufferedAuthorityForClose))?;
        require_keys_eq!(
            authority.key(),
            buffered_signatures.authority,
            OneSigError::UnauthorizedBufferedAuthority
        );
        emit_cpi!(BufferedSignaturesClosed {
            buffered_signatures: buffered_signatures.key(),
            authority: authority.key(),
        });
        buffered_signatures.close(authority.to_account_info())
    }

    /// Closes a buffered transaction after it has been executed successfully.
    fn maybe_close_buffered_transaction(
        ctx: &Context<'info, ExecuteTransaction<'info>>,
    ) -> Result<()> {
        let Some(buffered_transaction) = ctx.accounts.buffered_transaction.as_ref() else {
            return Ok(());
        };
        let authority = ctx
            .accounts
            .buffered_transaction_authority
            .as_ref()
            .ok_or(error!(OneSigError::MissingBufferedAuthorityForClose))?;
        require_keys_eq!(
            authority.key(),
            buffered_transaction.authority,
            OneSigError::UnauthorizedBufferedAuthority
        );
        emit_cpi!(BufferedTransactionClosed {
            buffered_transaction: buffered_transaction.key(),
            authority: authority.key(),
        });
        buffered_transaction.close(authority.to_account_info())
    }
}
