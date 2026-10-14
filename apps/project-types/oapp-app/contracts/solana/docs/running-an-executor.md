# Running a LayerZero Executor on Solana — Security Precautions

This note documents the security assumptions the Solana Executor program relies on and
the operational rules an operator MUST follow when running their own Executor. It exists
because these assumptions are enforced only for the parts the protocol can see; the rest is
the operator's responsibility. For the account-discovery flow and what a planner must guarantee,
see [lz-receive-types.md](./lz-receive-types.md#planner-obligations) and
[lz-compose-types.md](./lz-compose-types.md).

## TL;DR

**The Executor signing keypair must be a bare wallet that holds nothing but SOL.**

Do not let the Executor keypair own SPL / Token-2022 token accounts, NFTs, program
upgrade authority, multisig membership, or any account or privilege other than a plain
system-owned SOL balance. Use a keypair dedicated to execution and nothing else.

## Why this matters

`lz_receive` and `lz_compose` legitimately support "execute with value," so the Executor
must be able to sign the delivery transaction and spend some native SOL for it. The target
program is arbitrary and can be attacker-controlled: anyone can deploy an OApp and send it a
LayerZero message, so a malicious actor can make the Executor call an OApp they wrote. (The
same holds for compose, where the OFT sender picks the composer via the compose message.)

Take `lz_receive`. The execution plan is produced by **simulating the OApp's own
`lz_receive_types_v3` instruction** and trusting what it returns. See
[`receive-types-v3.ts`](../../../../../../packages/protocol/lz-v2-protocol-solana/src/receive-types-v3.ts)
(`buildLzReceiveExecutionPlanV3`, which resolves the plan with `resolvePlanV3` in
[`plan-v3.ts`](../../../../../../packages/protocol/lz-v2-protocol-solana/src/plan-v3.ts)):
the SDK materializes whatever account metas the OApp returns, and an account whose locator is
`Payer` is filled in with the real Executor payer and marked as a signer
(`isSigner: locator.__kind === 'Payer' || locator.__kind === 'Signer'`). The
planner transport checks validate the simulation, scratch output and plan structure —
they are **not** an allow-list of target programs or a restriction on which instructions
may carry the Executor's signature. Transaction resource limits still apply.
`lz_compose` works identically, via
`buildLzComposeExecutionPlanV3` in
[`compose-types-v3.ts`](../../../../../../packages/protocol/lz-v2-protocol-solana/src/compose-types-v3.ts).

In other words: a malicious OApp — or composer — can hand back a plan that puts the Executor
payer's signature onto an arbitrary instruction, including a Token-2022 `transfer_checked`
whose `authority` is the Executor payer.

## What the protocol enforces (and what it does not)

The Executor program brackets every execution between `PreExecute` and `PostExecute`
instructions and enforces two things about the payer:

1. **A native-SOL spend cap.** `PreExecute` snapshots the payer balance and records a
   `fee_limit`; `PostExecute` requires the balance not to have dropped by more than that
   limit:

    ```rust
    // pre_execute.rs
    context.initial_payer_balance = executor.lamports();
    context.fee_limit             = params.fee_limit;

    // post_execute.rs — validate_fee_limits_and_executor_state
    require!(balance_before <= balance_after + fee_limit, ExecutorError::InsufficientBalance);
    require!(executor.owner.key() == system_program::ID,   ExecutorError::InvalidOwner);
    require!(executor.data_is_empty(),                      ExecutorError::InvalidSize);
    ```

2. **The payer account is a bare system account.** The two `require!`s above reject a payer
   account that is program-owned or carries data.

These guards fully bound the _native SOL_ a malicious execution can cost, and the Executor
is reimbursed for legitimate execution through fees the user pays up front — so a
SOL-draining attempt does not harm a correctly provisioned Executor.

**What the protocol cannot see:** the guard inspects only the payer _account itself_. It
has no visibility into _other_ accounts owned by the same keypair. SPL / Token-2022 token
accounts are separate accounts owned by the Token program but whose `authority` is the
Executor keypair. If such accounts exist, a malicious OApp — or composer — plan can make the
Executor sign a transfer that moves those tokens out — and this is entirely outside the
`fee_limit` / bare-account check. This is by design: the protocol bounds native value; asset
isolation is an operator responsibility.

## Operator rules

- **Dedicate the keypair to execution.** One keypair, used only to sign
  receive/compose transactions and hold SOL for fees.
- **Never create token accounts under the Executor keypair.** No SPL, no Token-2022, no
  associated token accounts with the Executor as authority.
- **Do not assign the keypair any other authority** — no program upgrade authority, no
  mint/freeze authority, no multisig membership, no PDA authority.
- **Top up SOL from a separate funding wallet.** Keep the funding source and any treasury
  separate from the signing keypair.
- **Set `fee_limit` deliberately.** It is the only protocol-level bound on per-message SOL
  spend; provisioning it correctly offchain is load-bearing.

## References

- Cap + bare-account enforcement:
  [`post_execute.rs`](../../../../../../contracts/protocol/solana/contracts/programs/executor/src/instructions/post_execute.rs),
  [`pre_execute.rs`](../../../../../../contracts/protocol/solana/contracts/programs/executor/src/instructions/pre_execute.rs)
- Plan construction (trusts the OApp/composer simulation output):
  [`receive-types-v3.ts`](../../../../../../packages/protocol/lz-v2-protocol-solana/src/receive-types-v3.ts),
  [`compose-types-v3.ts`](../../../../../../packages/protocol/lz-v2-protocol-solana/src/compose-types-v3.ts)
- Planner locator types (`Payer`, `Signer`, `Address`, `Context`):
  [`types-v3.ts`](../../../../../../packages/protocol/lz-v2-protocol-solana/src/types-v3.ts)
