# Solana OneSig transaction notes

This note covers the Solana-specific rules for building and executing OneSig leaves.

The short version:

- Build one OneSig call from each target Solana instruction.
- Put one or more ordered calls in each leaf. A leaf uses a nonce and executes as one atomic batch.
- Use one leaf when the calls must be authorized and executed together. Use separate leaves when they should remain independently executable.
- Calls and signatures can be passed inline or uploaded to buffer accounts before execution when the payload does not fit in a Solana transaction.
- `call.keys[0]` is the target program id sentinel, not a target instruction account.
- In the leaf hash, only the OneSig signer PDA is marked as signer.
- Call **value** (SOL spent by OneSig) comes from the `one_sig_signer` PDA: that is the deposit address and spend balance. Outer tx fees are separate and paid by the executor fee payer.
- If an inner instruction can reduce the PDA's SOL balance, set that call's net lamport decrease allowance.
- Signer set size is capped at `SIGNERS_MAX_LEN` (50). Under the 4096-byte v1 limit all 50 × 65-byte signatures fit inline in one execute tx next to a small call (about 3.7 KB); the planner buffers signatures only when signatures plus calls do not fit.

## Call, Leaf, and Solana Transaction

A OneSig call is the OneSig representation of the target Solana instruction: target program id, account metas, instruction data, and maximum net lamport decrease. The SDK adds the program-id sentinel and normalizes signer flags.

A OneSig leaf authorizes an ordered list of those calls at one nonce (see Multi-Call Leaves below).

A Solana transaction carries `execute_transaction`. Calls and Merkle proof may be inline or read from a `BufferedTransaction` PDA. The program verifies the leaf, runs its calls in order as inner CPIs, and increments the nonce once after the whole leaf succeeds.

## Signature Encoding

Each secp256k1 signature is 65 bytes:
`r (32 bytes) || s (32 bytes) || recovery_id (1 byte)`. Only recovery IDs `0`, `1`, `27`, and `28`
are accepted; the program normalizes `27/28` to `0/1`. Signatures must be low-S (`s <= n/2`) to match
EVM/OpenZeppelin recovery rules; Solana's `secp256k1_recover` alone does not enforce that.

## Multi-Call Leaves and Atomic Workflows

Unlike older Solana OneSig docs that described one instruction per leaf, a leaf may contain one or more
calls. `execute_transaction` verifies the leaf before any CPI, runs every call in order, and increments
the nonce once after the whole list succeeds. If any call fails, earlier calls in that execution and the
nonce change roll back.

Use one multi-call leaf when the calls must be approved and executed as one indivisible workflow:

```text
leaf nonce N
  call 1 -> unpause
  call 2 -> lz_receive
  call 3 -> pause
```

Order is part of the leaf hash, so calls cannot be reordered, removed, or submitted separately.

Use separate leaves when each call should have its own authorization and replay slot:

```text
leaf nonce N     -> unpause
leaf nonce N + 1 -> lz_receive
leaf nonce N + 2 -> pause
```

Those executions may share one Solana transaction for transaction-level atomicity, but each leaf stays
independently authorized and consumes its own nonce. Anyone with a valid call and proof may submit an
individual leaf when its nonce becomes current.

Both shapes are limited by Solana transaction size, account locks, heap, compute, and the target
programs. A large multi-call leaf may need buffered call data even though it is only one OneSig
execution. A leaf that is signed but cannot fit or execute under those limits will stall the nonce
sequence until signers authorize a different executable leaf for that nonce.

## Nested OneSig Execution

OneSig execution cannot be nested. The reentrancy guard rejects an inner call to OneSig's
`execute_transaction`, including a call that targets a different OneSig state.

## Execution Modes and Capacity Tools

`execute_transaction` has two independent data choices. Buffer only the dimension that exceeds Solana
limits:

| Merkle root signatures | Leaf calls and proof | When to use it                                                                                                               |
| ---------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Inline                 | Inline               | The simplest path when signatures and the leaf payload fit in one Solana transaction.                                        |
| Buffered               | Inline               | Useful when the signer threshold is large, or several leaves share one signed root. Upload signatures once, then reuse them. |
| Inline                 | Buffered             | Useful when one leaf has many calls or large instruction data, but the signatures still fit.                                 |
| Buffered               | Buffered             | Use when both the root signatures and the leaf payload are too large to carry inline.                                        |

Buffered signatures use `init_buffered_signatures` / `append_buffered_signatures`; later executions read
the `BufferedSignatures` PDA. Buffered leaves use `init_buffered_transaction` /
`append_buffered_transaction` (calls bytes plus Merkle proof). A successful execution closes the
`BufferedTransaction` PDA and refunds rent to its authority.

Other capacity notes:

- Buffering call data does not remove account-lock or compute limits; CPI accounts still pass through
  `remaining_accounts`.
- Solana v1 transactions carry every account inline (no address lookup tables) and cap a transaction
  at 64 accounts, 12 signatures and 4096 bytes.
- Compute budget is a per-step v1 transaction config (`transactionConfig`: compute-unit limit, heap
  frame, loaded-accounts data size), not instructions. It belongs to the outer Solana transaction,
  never inside OneSig calls. The program uses a custom upward bump allocator (`custom-heap`) so
  requested heap frames are usable; the default Solana bump allocator does not grow into extra heap.
- The planner sizes transactions only. A large inline leaf can fit 4096 bytes and still exceed the
  1.4M compute-unit limit or the 64-entry instruction trace; that remains the caller's check.
  Large inline payloads may also need `heapSize`: without it the execute step runs on the default
  32 KiB heap. onesig-sdk requests `MAX_HEAP_FRAME_BYTES`.
- Prefer submitting only the threshold number of signatures when possible to reduce tx size and compute.

## Call Encoding

A target Solana instruction looks like this:

```ts
const instruction = {
    programId,
    keys: [accountA, accountB, accountC],
    data,
};
```

The OneSig call prepends the target program id to `keys`. `call.programId` and `call.keys[0].pubkey`
must identify the same target program:

```ts
const call = {
    programId,
    keys: [{ pubkey: programId, isSigner: false, isWritable: false }, accountA, accountB, accountC],
    data,
    value: lamportsAllowance,
};
```

When building `execute_transaction`, program ids and accounts used by all calls are deduplicated into
one `remaining_accounts` table. Each call gets a `callAccountRefs` entry of indices into that table:

```ts
callAccountRefs[callIndex] = [
    { index: targetProgramIndex, isWritable: false },
    ...targetAccountRefs,
];
```

The first reference selects the target program. The rest select that call's CPI accounts. The outer
account table uses writable permission if any call needs to write an account, while each reference
keeps the narrower writable permission signed for that specific call. All submitted
`remaining_accounts` have `isSigner = false`; on-chain reconstruction marks only the OneSig signer PDA
as signer before `invoke_signed`.

For Merkle hashing, `keys[0]` is not hashed as an account meta. It is the target program id entry:

```ts
const merkleInstruction = {
    programId: call.programId, // Must match call.keys[0].pubkey.
    keys: call.keys.slice(1).map((meta) => ({
        ...meta,
        // Only the OneSig signer PDA is signer in the leaf hash. This mirrors
        // the signer bit reconstructed on-chain before `invoke_signed`.
        isSigner: meta.pubkey === oneSigSignerPda,
    })),
    data: call.data,
    value: call.value,
};
```

The OneSig signer PDA cannot sign the submitted Solana transaction directly. Submit account metas with
signer flags cleared; when building the leaf hash, set `isSigner = true` only for the OneSig signer
PDA. The program reconstructs the same PDA signer bit on-chain and signs the inner CPI with
`invoke_signed`.

## Target Program Trust

A leaf binds the target program id, accounts, and instruction data, but not the program's deployed code
or upgrade authority. If the target is upgraded after the leaf is signed, its new code can still receive
the OneSig signer PDA through `invoke_signed`.

On Solana, signer privilege propagates through nested CPIs: a target that receives `one_sig_signer` can
pass that signer to further programs. That differs from EVM OneSig, where a downstream call sees
`msg.sender` as the target, not OneSig. Prefer frozen or trusted programs, check upgrade authorities,
use short root expiries, and mark the OneSig signer PDA writable only when required. Treat any target
that receives the PDA as trusted for the full downstream CPI flow, not only the immediate instruction.
The reentrancy guard still blocks those targets from calling back into OneSig `execute_transaction`.

## Executor Policy

`executor_required` and the executor allowlist are checked at execution time; they are not in the signed
root or leaf. If either setting is relaxed, previously signed unexpired leaves may become executable by
more callers. Rotate the seed at the same time if those old roots should no longer be usable.

When `executor_required` is set, the submitting `executor` must be allowlisted or present a valid
`signer_authorization`. When unset, execution is permissionless. A supplied `signer_authorization` is
ignored unless the executor gate needs it; omit it when unused.

`SignerExecutionAuthorization` omits `seed` (enforced via root signatures). Rotating `seed` invalidates
old root signatures, so an old authorization cannot execute alone. If signers re-approve the same
`merkleRoot` under the new `seed`, an existing unexpired authorization for the same leaf, root, and
delegate remains valid.

## Lamport Decrease Allowance

`one_sig_signer` is the OneSig deposit address for call **value**. Fund SOL there when a leaf will
transfer SOL, pay rent, or otherwise spend from OneSig. That spend comes from the PDA balance, not
from the executor. Outer Solana transaction fees remain the executor fee payer's responsibility.

Some instructions reduce the PDA's lamport balance: SOL transfers, rent for new accounts, account
initialization, and similar flows. Each call has its own allowance for the maximum net decrease between
the balance immediately before and after that call's CPI:

```text
max(0, balanceBefore - balanceAfter) <= lamportsAllowance
```

Common values:

```ts
// No SOL leaves the OneSig signer PDA.
lamportsAllowance = 0n;

// SOL transfer from the OneSig signer PDA.
lamportsAllowance = transferLamports;

// Account creation funded by the OneSig signer PDA.
lamportsAllowance = rentLamportsOrSimulatedDeduction;
```

This is not a cap on gross lamport flow: a call may first add lamports to the PDA and then spend them,
as long as that call's final net decrease stays within its allowance. The allowance does not fund the
PDA. If the generator cannot know it statically, simulate the instruction against the intended chain
state and use the observed net decrease.

After every CPI, the program also checks that the OneSig signer PDA is still owned by the System Program
and has no allocated data.

## Helper API

`buildOneSigSolanaLeaves` is exported from the package root. It reads the current OneSig state,
resolves each instruction's lamport allowance using the caller's explicit strategy, and builds leaves
from `instructionGroups`. Each inner array becomes one leaf and consumes one nonce: `[[a], [b]]`
creates two independent leaves, while `[[a, b]]` binds both instructions into one atomic multicall
leaf.

The `estimate-independently` strategy simulates every instruction independently against current chain
state. Each instruction runs in full, including internal CPIs such as PDA creation. The strategy
prepares the allowance included in each signed leaf; it does not replay state between top-level
instructions or validate complete leaf execution. Instructions that depend on state created or
modified by an earlier instruction must use the `explicit` strategy with values matching the shape
of `instructionGroups`. Each value remains a per-call cap on the OneSig signer PDA's net lamport
decrease.

The helper returns the Merkle root, calls, and proofs. It does not sign the root. Sign `built.merkleRoot` through the normal OneSig signing flow, then pass the same `expiry` and signature bytes to the structured execution builder:

```ts
const built = await buildOneSigSolanaLeaves({
    rpc, // a kit RPC, e.g. createSolanaRpc(url): reads state, a recent blockhash and runs v1 simulations
    oneSigState,
    instructionGroups: [[firstInstruction, secondInstruction]],
    // Use `estimate-independently` only when instructions do not depend on one another.
    lamportAllowances: {
        kind: 'explicit',
        values: [[firstAllowance, secondAllowance]],
    },
    commitment: 'confirmed',
});

// Obtained by signing built.merkleRoot. `threshold` is the on-chain OneSig threshold.
const expiry = rootSignatureExpiry;
const signatureBytes = concatenatedSignatures;
const threshold = onChainThreshold;

const executeIxs = built.leaves.map((leaf) =>
    oneSig.execution.buildInstruction({
        executor,
        merkleRoot: built.merkleRoot,
        expiry,
        threshold,
        payload: { kind: 'inline', calls: leaf.calls, proof: leaf.proof },
        signatures: { kind: 'inline', signatures: signatureBytes },
    }),
);
```

The grouping is part of the signed leaf and cannot be changed after the Merkle root is signed. The
caller still chooses how to submit distinct leaves: one execution per Solana transaction, or several
executions packed into the same Solana transaction.

For buffered execution, use `oneSig.transactionBuffer.buildPlan()` and
`oneSig.signatureBuffer.buildPlan()`. The signature planner takes the on-chain `threshold` and
rejects a blob shorter than that count; the transaction planner does not, because it uploads calls,
not signatures. Each planner measures its init and append instruction shapes and packs the buffered
bytes to the transaction limit. Submit each plan's `steps` in order, then pass the returned `source`
to `oneSig.execution.buildInstruction()`.

The fee payer defaults to the buffer authority. Declare every size-affecting submission input when
the transaction differs:

```ts
const transactionPlan = oneSig.transactionBuffer.buildPlan({
    authority,
    merkleRoot,
    nonce,
    calls,
    proof,
    transaction: {
        feePayer,
        config, // v1 config; defaults to DEFAULT_BUFFER_TRANSACTION_CONFIG
        maxTransactionBytes,
    },
});
```

`initChunkSize` and `appendChunkSize` are optional upper bounds on buffered bytes:

```ts
const signaturePlan = oneSig.signatureBuffer.buildPlan({
    authority,
    merkleRoot,
    signatures,
    threshold,
    initChunkSize: 700,
    appendChunkSize: 900,
});
```

`measureTransactionBytes()` provides RPC-free Solana v1 transaction sizing when a caller needs an
exact check. It takes `@solana/kit` types: pass Kit instructions (convert umi instructions first,
keeping account order, duplicate accounts and their roles), the fee payer as a Kit `Address` and
the exact v1 config the submitter will send, then compare the result with `MAX_TRANSACTION_BYTES`
(4096) or call `assertTransactionSize()`. A caller-supplied ceiling may only lower that cap
(`assertTransactionByteLimit`).

`planOneSigSolanaExecution()` returns steps that each carry one instruction and a v1
`transactionConfig`; submit `instructionsForStep(step)` with that config and no ComputeBudget
instructions. A submitter that only takes web3.js instructions, like the Solana sender onesig-sdk
uses, must instead encode the config as ComputeBudget instructions: the sender lifts them back into
the v1 config and strips them from the message, so the size is the same. The execute step's config
comes from `computeBudget`: `computeUnitLimit` (defaults to
`DEFAULT_COMPUTE_UNIT_LIMIT`, validated by `assertComputeUnitLimit`) and an optional `heapSize`
(32KiB..256KiB, 1024-byte multiples, `assertHeapFrameBytes`). Buffer steps use
`DEFAULT_BUFFER_TRANSACTION_CONFIG`. Every step requests `MAX_LOADED_ACCOUNTS_DATA_SIZE_LIMIT`,
because v1 budgets zero compute units and zero loaded data when a field is unset. Priority fees are
the submitter's: `transactionBytes` is the exact v1 size including the submitter's 8-byte priority
fee, and a heap frame costs 4 bytes only when requested. To change a compute budget, plan again;
planning is pure and cheap.

## Checklist

Build and sign:

1. Fetch the OneSig state account and start from its current `nonce`.
2. Convert each target Solana instruction into one OneSig call.
3. Group calls that must stay together into the same leaf, in execution order.
4. Give each leaf one nonce. Use consecutive nonces only when building multiple leaves.
5. If the leaf spends SOL (transfers, rent, etc.), ensure `one_sig_signer` is funded; set or simulate each call's lamport decrease allowance against that PDA.
6. Hash each leaf with only the OneSig signer PDA marked as signer.
7. Confirm each leaf can execute under Solana size / account / compute limits (buffer or split if not).
8. Build the Merkle tree and have signers sign its root.

Execute:

1. Check whether the root signatures and leaf payload fit inline.
2. Buffer signatures, calls, or both when the inline execution would exceed Solana limits.
3. Execute multiple leaves in nonce order. Calls inside one leaf run in their signed order and consume one nonce together. Call value still comes from `one_sig_signer`; the executor only pays the outer tx fee.

If a local Merkle root differs from the expected root, check the normalized call shape:

```text
call.keys[0]          == target program id sentinel, not a target account
hashed accounts       == call.keys.slice(1)
only PDA is signer    == true
all other signers     == false
instruction data      == exact bytes to execute
call order            == exact order signed in the leaf
lamport allowance     == same per-call value used for signing/execution
```
