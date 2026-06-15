# Solana OneSig transaction notes

This note covers the Solana-specific rules for building and executing OneSig leaves.

The short version:

- Build one OneSig call from each target Solana instruction.
- Build one leaf per call. A batch of leaves can share one Merkle root.
- A Solana transaction can execute one or more leaves. Pack multiple leaf executions into one Solana transaction when they must commit atomically.
- `call.keys[0]` is the target program id sentinel, not a target instruction account.
- In the leaf hash, only the OneSig signer PDA is marked as signer.
- If the inner instruction can spend SOL from the PDA, set the leaf's lamport spend allowance.

## Call, Leaf, and Solana Transaction

A OneSig call is the OneSig representation of the target Solana instruction. It contains the target program id, account metas, instruction data, and lamport spend allowance. The SDK builds it by adding the target program id sentinel and normalizing signer flags.

A OneSig leaf authorizes one normalized call at one nonce. The leaf hash commits to the OneSig state, OneSig id, nonce, target program id, account metas, instruction data, and lamport allowance.

A Solana transaction carries the OneSig execution instruction. At execution time, the caller submits the call plus its Merkle proof to `execute_transaction` or `signer_execute_transaction`; the OneSig program verifies the proof and dispatches the call as one inner CPI.

## One Call Per Leaf

Solana OneSig uses one call per leaf. A leaf authorizes one inner CPI. If a workflow has several steps, build several leaves instead of putting a `calls[]` array inside one leaf.

This is a OneSig authorization boundary, not a Solana transaction boundary. A Solana transaction may still execute multiple leaves.

The design follows Solana's resource model:

- A Solana transaction has a 1232-byte serialized size limit.
- Programs start with a 32 KiB heap frame by default.
- Each transaction has compute limits.

Each OneSig execution has to fit inside those limits. During execution, the program decodes the OneSig transaction params, verifies the leaf proof, rebuilds the inner instruction from `remaining_accounts`, and passes variable-size instruction data to the CPI.

If one leaf supported multiple calls, one `execute_transaction` would need to carry and process multiple target program ids, account lists, and instruction data blobs. Some combinations would fit; others would fail because of transaction size, heap, compute, or target-program constraints.

One call per leaf keeps the resource boundary clear: each leaf has one call to fit and one CPI to execute. Multi-step workflows can still be atomic by executing multiple leaves in one Solana transaction.

## Atomic Workflows

When several OneSig calls must commit atomically, execute their leaves in the same Solana transaction.

This is transaction-level atomicity, not the same authorization model as EVM `calls[]`. Each Solana leaf still authorizes one call and has its own proof. If someone has a leaf's call and proof, that leaf can be submitted separately when nonce order allows. Packing multiple leaves into one Solana transaction only makes that submission succeed or fail as one transaction.

For example, model `unpause -> lz_receive -> pause` as three leaves:

```text
leaf nonce N     -> unpause
leaf nonce N + 1 -> lz_receive
leaf nonce N + 2 -> pause
```

Then pack the executions into one Solana transaction:

```text
Solana transaction
  execute leaf N
  execute leaf N + 1
  execute leaf N + 2
```

Order matters because each successful execution consumes the current OneSig nonce. If that Solana transaction fails, all nonce changes and inner CPIs roll back together.

## Capacity Tools

Use these when the Solana transaction carrying the execution instructions does not fit within Solana limits.

- Address lookup tables reduce the account address footprint of the Solana transaction carrying the execution instructions. They do not change the OneSig leaf format or remove the execution-time cost of decoding, verifying, and dispatching each call.
- Compute budget instructions can request a larger heap frame or a higher compute unit limit for that Solana transaction. Place them in the Solana transaction, not inside OneSig calls. Heap frame requests can raise the default 32 KiB heap up to 256 KiB.
- Two-step root verification moves root signature verification into `verify_merkle_root`. Later executions read the pre-verified `MerkleRootState` instead of carrying root signatures again.

These tools help larger Solana transactions fit, but they do not change the core model: each leaf authorizes and executes one OneSig call.

## Call Encoding

A target Solana instruction looks like this:

```ts
const instruction = {
    programId,
    keys: [accountA, accountB, accountC],
    data,
};
```

The OneSig call prepends the target program id to `keys`. This lets the program receive the target program id through Anchor `remaining_accounts`. `call.programId` and `call.keys[0].pubkey` must identify the same target program:

```ts
const call = {
    programId,
    keys: [{ pubkey: programId, isSigner: false, isWritable: false }, accountA, accountB, accountC],
    data,
    value: lamportsAllowance,
};
```

On-chain execution reads the target program id from the first remaining account and passes the rest to the inner CPI:

```ts
const targetProgramId = remainingAccounts[0];
const targetAccounts = remainingAccounts.slice(1);

invokeSigned({
    programId: targetProgramId,
    accounts: targetAccounts,
    data,
});
```

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

The signer rule is important. The OneSig signer PDA cannot sign the submitted Solana transaction directly. Submit account metas with signer flags cleared; when building the leaf hash, set `isSigner = true` only for the OneSig signer PDA. The program reconstructs the same PDA signer bit on-chain and signs the inner CPI with `invoke_signed`.

## Lamport Spend Allowance

Some instructions spend lamports from the OneSig signer PDA: SOL transfers, rent for new accounts, account initialization, and similar flows. A leaf must state how many lamports it authorizes the inner instruction to deduct from the PDA.

Think of it as:

```text
allowed PDA balance decrease <= lamportsAllowance
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

This allowance does not fund the PDA. The PDA still needs enough SOL before execution. If the generator cannot know the amount statically, simulate the instruction against the intended chain state and use the observed PDA balance decrease.

## Helper API

The leaf helper is exported from the package root. It reads the OneSig state account, simulates lamport allowances, builds the Merkle root, and returns leaves with proofs.

```ts
const built = await buildOneSigSolanaLeaves({
    connection,
    dummyFeePayer,
    oneSigState,
    instructions,
});

const executeIxs = built.leaves.map((leaf) =>
    oneSig.executeTransaction(executor, built.merkleRoot, {
        call: leaf.call,
        proof: leaf.proof,
        merkleRootVerification,
    }),
);
```

The helper builds leaves. The caller still chooses how to submit them: one execution per Solana transaction, or several executions packed into the same Solana transaction for atomicity.

## Checklist

Build and sign:

1. Fetch the OneSig state account and start from its current `nonce`.
2. Convert each target Solana instruction into one OneSig call.
3. Build one leaf per call with consecutive nonces.
4. Set or simulate the lamport spend allowance.
5. Hash each leaf with only the OneSig signer PDA marked as signer.
6. Have signers sign one Merkle root for the batch.

Execute:

1. Choose the execution shape: separate Solana transactions, or one Solana transaction with multiple leaf executions for atomicity.
2. Execute leaves in nonce order.

If a local Merkle root differs from the expected root, check the normalized call shape:

```text
call.keys[0]          == target program id sentinel, not a target account
hashed accounts       == call.keys.slice(1)
only PDA is signer    == true
all other signers     == false
instruction data      == exact bytes to execute
lamport allowance     == same value used for signing/execution
```
