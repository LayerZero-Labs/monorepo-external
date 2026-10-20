# OneSig Solana — Audit Scope & Design Synopsis

`onesig` is the Solana leg of LayerZero's cross-VM **OneSig** multisig. Governance signers approve a
Merkle root of pending transactions off-chain by signing an EIP-712 digest with Ethereum-style
secp256k1 keys; any relayer then submits the individual transactions on-chain, where the program
re-verifies a threshold of signatures, proves the transaction's leaf against the signed root, and
executes its calls on behalf of a program-derived signer (`one_sig_signer`). The signer set,
threshold, and Merkle-root semantics mirror the EVM OneSig so one signed root can authorize action
across every chain a OneSig controls.

For architecture background see the [docs](./docs/solana-onesig-transaction-notes.md).

---

## Problem

The EVM OneSig authorizes an arbitrary batch of calls per signed leaf and verifies an arbitrary
number of signatures in one call — EVM has no per-transaction size ceiling that bites at these
sizes. Solana does. A single Solana transaction is capped at **1232 bytes** and **64 account locks**
(the `increase_tx_account_lock_limit` feature is not active on mainnet), and every executed call is a
CPI subject to the **64-entry instruction-trace** and compute-unit limits. Three things therefore do
not fit a single transaction and must be assembled across several:

1. **A large batch of calls** under one signed leaf (e.g. a DVN reconfiguration touching many remote
   EIDs) — the calls' bytes alone blow the 1232-byte limit.
2. **A high signer threshold** — each signature is 65 bytes, so an inline threshold caps at ~13
   signatures before the transaction is too large.
3. **A deep Merkle tree's proof** — though in practice this never binds (see Empirical Limits).

The design goal was to preserve the EVM OneSig's "one signed leaf → atomic batch" and
"threshold-of-N" semantics on Solana, by letting the calls and the signatures each be **buffered
across multiple transactions** into program-owned accounts and then consumed by one execution, while
keeping the on-chain trust boundary at a single Merkle-proof check.

---

## What the program does (design)

**One leaf authorizes an ordered batch of calls.** A leaf commits to `Vec<OneSigCall>` (each call =
`ix_data` + a `value` net-lamport-decrease cap) plus the OneSig instance (`one_sig_id`, state pubkey) and
`nonce`. `execute_transaction` runs the whole batch atomically and bumps the nonce exactly once, so
one signed leaf = one indivisible batch = one replay slot.

**Instance identity.** `one_sig_id` is chosen by the caller, is not globally unique, and is not
required by the program to match the chain EID. Indexers and integrations must use `(OneSig program
id, OneSigState pubkey)` as the canonical Solana instance identity; they must not use `one_sig_id`
alone as a database or routing key. Both the state pubkey and `one_sig_id` are included in every leaf.
Cross-chain bundles typically set `one_sig_id` to the chain EID; use distinct values per target in the
same bundle.

**`execute_transaction` is a single instruction with three orthogonal dimensions:**

| Dimension         | Inline                                                      | Buffered                                                                                              |
| ----------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Signatures**    | `params.signatures: Some(..)` verified in this tx           | omitted → read from a `BufferedSignatures` PDA accumulated across `init/append_buffered_signatures`   |
| **Calls**         | `params.transaction: Some(OneSigTransaction{calls, proof})` | omitted → read from a `BufferedTransaction` PDA accumulated across `init/append_buffered_transaction` |
| **Executor auth** | permissionless, or an allowlisted `executor`                | a signer-issued `signer_authorization` delegate proof (only enforced when `executor_required`)        |

Any combination is valid, so a caller uses inline for what fits one tx and buffers only the
dimension that doesn't. The former separate signer-as-executor instruction is folded into this one as
the optional `signer_authorization`.

**Buffers stage raw bytes across transactions.** `BufferedTransaction` stores the exact Borsh
serialization of `Vec<OneSigCall>`, and `BufferedSignatures` stores the concatenated signature blob.
Both are written with a first chunk at init and subsequent chunks by **byte `start_offset`**
(compare-and-swap against the current length), so a payload larger than one transaction is assembled
in order across several. Buffers are permissionless to create — their content is **untrusted** until
the execute-time proof/threshold check (below), so a mis-assembled or hostile buffer simply fails to
execute; it can never execute the wrong thing.

---

## How it works (security-relevant mechanisms)

- **Leaf binding.** `MerkleValidator::encode_leaf` = `keccak(keccak(version ‖ one_sig_id(BE) ‖
state_pubkey ‖ nonce(BE) ‖ Σ borsh(OneSigInstruction)))`. Each `OneSigInstruction` commits the CPI
  program id and the fully-resolved account list — every account's `(pubkey, is_signer, is_writable)`
  and the call's `ix_data` and `value` — in execution order. Every variable field is Borsh
  length-prefixed, so the concatenation is uniquely decodable and the encoding is non-malleable (no
  re-partitioning of the byte stream into a different call set can collide). Header integers are
  big-endian to match the EVM leaf; Borsh bodies are little-endian.
- **The single trust check.** `execute_transaction` re-derives the leaf from the _reconstructed_
  instructions (not from any buffered/cached hash) and verifies `verify_merkle_proof(root, proof,
leaf)` **before any CPI**. Whatever the buffers contained, if the resulting calls differ from what
  the signers approved, the leaf differs and the proof fails.
- **Root signatures.** The root is authorized by a threshold of secp256k1 signatures over the EIP-712
  digest `keccak(0x1901 ‖ DOMAIN_SEPARATOR ‖ keccak(SignMerkleRoot(seed, merkleRoot, expiry)))`.
  `seed` is a signing-domain / cross-VM instance-group identifier: it makes a root signature
  portable across compatible instances, but does not select an execution target. The leaf's state
  pubkey, `one_sig_id`, nonce, and calls select that target. On Solana, `expiry` is a `u64` Unix
  timestamp in seconds; only in the EIP-712 preimage is it represented as a big-endian `uint256`,
  left-padded with 24 zero bytes.
  `recover_signers` recovers each 65-byte chunk via `secp256k1_recover`, requires each recovered
  20-byte address to be a **distinct registered signer**, and `verify_n_signatures` requires the count
  ≥ threshold. Signatures are enforced **low-S** (`s <= n/2`, `SECP256K1_HALF_ORDER`) in
  `recover_signer` to reject the malleable high-S twin `(r, n − s, v ^ 1)`, which recovers to the same
  signer. This is a cross-chain-consistency / footgun hardening, not a threshold-bypass fix (the twin
  recovers to an already-known address, and duplicate addresses are already rejected via
  `AlreadyAdded`).
    - _Solana does not do this for us, and says so._ The `solana-secp256k1-recover` crate docstring
      (the version we depend on, `secp256k1-recover@v3.1.0`) is explicit — it both states the syscall
      does not canonicalize and recommends exactly the low-S rejection we implement:

        > **The solana `secp256k1_recover` function does not prevent signature malleability**. … Solana
        > accepts signatures with `S` values that are either in the _high order_ or in the _low order_ …
        > To prevent signature malleability, it is common for secp256k1 signature validators to only
        > accept signatures with low-order `S` values, and reject signatures with high-order `S` values.

        It is the only recovery fn the crate exports — no variant enforces low-S — and its own example
        also points to OpenZeppelin's `recover` as the reference implementation.
        ([`secp256k1-recover/src/lib.rs#L151-L190` @ `v3.1.0`](https://github.com/anza-xyz/solana-sdk/blob/secp256k1-recover@v3.1.0/secp256k1-recover/src/lib.rs#L151-L190))

    - _The EVM side does._ Our constant `SECP256K1_HALF_ORDER = n/2` is byte-identical to OpenZeppelin
      `ECDSA.tryRecover`'s bound `0x7FFF…B20A0`; OZ rejects `s >` that with `InvalidSignatureS`, and its
      strict `>` (so `s == n/2` is valid) matches our inclusive `<=`. OZ cites EIP-2 and Yellow Paper
      Appendix F (301) `0 < s < n÷2 + 1`, (302) `v ∈ {27,28}`.
      ([`ECDSA.sol#L170-L196`](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/utils/cryptography/ECDSA.sol#L170-L196))

- **Account resolution.** `call_account_refs[i] = [program_id, ...accounts]`, each entry a
  `CallAccountRef { index, is_writable }` into the caller-supplied `remaining_accounts` table
  (typically deduped). Indices are bounds-checked. The per-call `is_writable` (not the runtime
  account's flag) is what enters the reconstructed leaf and the CPI meta, so a call may only ever
  _narrow_ a transaction-writable account to readonly — widening fails, as `invoke_signed` cannot
  escalate a readonly account to writable. `is_signer` is set true only for `one_sig_signer`.
- **Execution guards.** Per call: a `value` cap on how far the `one_sig_signer` lamport balance may
  decrease (`ExcessiveBalanceDeduction`); a check that `one_sig_signer` stays System-owned and
  unallocated after each CPI; and a **reentrancy guard** rejecting any inner CPI back into
  `execute_transaction`. The nonce is reloaded and bumped exactly once after the batch, so an inner
  CPI cannot advance it. Unlike EVM `msg.sender`, Solana signer privilege on `one_sig_signer` can
  propagate through nested CPIs of a trusted target; the reentrancy guard blocks only reentry into
  OneSig itself.
- **Executor set.** `executor_required = true` with an empty executor allowlist is allowed (signers
  can still authorize delegates via `signer_authorization`). There is no `EmptyExecutorSet` lockout.
- **Accounts / PDAs.** `OneSigState` is a caller-provided keypair account (must co-sign
  `init_one_sig`), not a PDA. `one_sig_signer = PDA[b"OneSig", state]` is the CPI authority and the
  deposit address for call **value** (SOL transfers / rent leave this PDA; outer tx fees are paid by
  the executor fee payer, not from this balance).
  `BufferedSignatures = PDA[b"BufferedSignatures", state, merkle_root, authority]`;
  `BufferedTransaction = PDA[b"BufferedTransaction", state, merkle_root, nonce(BE), authority]` (the
  seeds namespace concurrent buffers; content is bound to root+nonce cryptographically at execute).
- **Rent / lifecycle.** A `BufferedTransaction` is closed unconditionally on successful execution
  (rent → its `authority`); a `BufferedSignatures` carries a `closable_after_nonce` and is auto-closed
  by `execute_transaction` once `one_sig_state.nonce` passes it (`u64::MAX` disables). Either buffer
  can also be closed anytime by its `authority` via `close_buffered_*`. `set_config` mutations
  (`AddSigner`/`RemoveSigner`/`SetThreshold`/`SetSeed`/executor toggles) are themselves only reachable
  through an executed leaf (the `one_sig_signer` PDA must sign), i.e. governance changes go through the
  same signed-root path.

---

## Empirical limits

Measured on a local validator by the profiling scripts in
`@layerzerolabs/onesig-solana-sdk` (`../onesig-solana-sdk/profile/`, `pnpm waterfall:*`);
these document where each dimension actually binds, not new constraints:

| Axis                                      | Ceiling                              | Bound by                                                |
| ----------------------------------------- | ------------------------------------ | ------------------------------------------------------- |
| Inline signatures (one execute tx)        | **13**                               | 1232-byte tx size (= the historical `MAX_THRESHOLD`)    |
| Buffered signatures                       | **41+** at constant ~387B execute tx | `SIGNERS_MAX_LEN` (50) / init registration, not tx size |
| Signer registration in one `init_one_sig` | **~41**                              | tx size (reaching 50 needs incremental `set_config`)    |
| Buffered multicall — signer swaps         | **15** pairs (30 CPIs)               | 64-entry instruction-trace limit                        |
| Buffered multicall — DVN `set_config`     | **13** configs / **208** DVNs        | 64 account-lock limit                                   |
| Merkle proof                              | non-binding to ~**2²⁶** leaves       | never the limiting factor in practice                   |

Takeaways for review: the inline threshold ceiling (13) is a hard tx-size fact, and
`BufferedSignatures` is the mechanism that lifts a threshold past it at constant execute-tx size;
proof buffering is unnecessary at any realistic tree size. A signed leaf that cannot fit or execute
under size/account/compute limits stalls the nonce sequence until signers authorize a different
executable leaf for that nonce. `SIGNERS_MAX_LEN` is **50** (registration cap; not a threshold
ceiling).

---

## Files in Scope (`programs/onesig/src/`)

| File                                                                                                           | Description                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib.rs`                                                                                                       | Program entrypoints: `init_one_sig`, `set_config`, `execute_transaction`, `init/append/close_buffered_transaction`, `init/append/close_buffered_signatures`, `version`              |
| `constants.rs`                                                                                                 | Seeds, `SIGNERS_MAX_LEN=50`, `EXECUTORS_MAX_LEN=277`, `SIGNATURE_BYTES_LEN=65`, leaf-encoding version, EIP-712 `DOMAIN_SEPARATOR` and type hashes                                   |
| `types.rs`                                                                                                     | `Address`, `Secp256k1Pubkey`, `Signature`, `Hash`, `OneSigCall`, `OneSigInstruction`, `OneSigTransaction`, `SignerAuthorization`, `AccountIndexMeta`                                |
| `errors.rs`                                                                                                    | `OneSigError` (authorization, proof, signature, buffer-assembly, execution-guard codes)                                                                                             |
| `events.rs`                                                                                                    | `OneSigInitialized`, `ConfigSet`, `TransactionExecuted`, `BufferedSignaturesInitialized`, `BufferedTransactionInitialized`, `BufferedSignaturesClosed`, `BufferedTransactionClosed` |
| `state/one_sig.rs`                                                                                             | `OneSigState` (nonce, seed, `Multisig` signers+threshold, `Executors`) and its mutation methods                                                                                     |
| `state/buffered_transaction.rs`                                                                                | `BufferedTransaction` account — buffered `Vec<OneSigCall>` bytes + proof; `calls()` deserialize-and-integrity-check                                                                 |
| `state/buffered_signatures.rs`                                                                                 | `BufferedSignatures` account — accumulated signature blob + `closable_after_nonce`                                                                                                  |
| `instructions/init_one_sig.rs`                                                                                 | Creates `OneSigState`, derives `one_sig_signer` bump, seeds signers/executors/threshold                                                                                             |
| `instructions/set_config.rs`                                                                                   | Signer/threshold/seed/executor mutations — reachable only via an executed leaf                                                                                                      |
| `instructions/execute_transaction.rs`                                                                          | Core: resolve calls source + signature source, encode leaf, verify proof + threshold + executor auth, execute CPIs under the PDA, bump nonce, close/auto-close buffers              |
| `instructions/init_buffered_transaction.rs`, `append_buffered_transaction.rs`, `close_buffered_transaction.rs` | Stage `Vec<OneSigCall>` bytes across byte-offset chunks; append guarded by `start_offset`                                                                                           |
| `instructions/init_buffered_signatures.rs`, `append_buffered_signatures.rs`, `close_buffered_signatures.rs`    | Accumulate the signature blob across byte-offset chunks                                                                                                                             |
| `validation/merkle.rs`                                                                                         | Leaf encoding, Merkle-proof verification, EIP-712 root-digest construction                                                                                                          |
| `validation/signature.rs`                                                                                      | secp256k1 recovery, distinct-registered-signer checks, threshold check, signer-execution (delegate) proof                                                                           |

---

## Out of Scope

| Path                                                                       | Reason                                                                                  |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `../onesig-solana-sdk/` (`@layerzerolabs/onesig-solana-sdk`)               | TypeScript SDK, codegen, vitest unit/integration tests, validator scripts and profiling |
| `scripts/`, `build/`, `target/`                                            | Tooling, IDL, and build artifacts                                                       |
| `validation/tests/`                                                        | Rust unit tests                                                                         |
| `test/`                                                                    | vitest checks of the build guard script and the deployable program's SBPF version       |
| `Anchor.toml`, `Cargo.*`, `package.json`, `README.md`, `AUDIT.md`, `docs/` | Config, manifests, and documentation                                                    |

---

## Addendum (2026-10-09): Solana v1 transactions

This addendum does not change the audited program, leaf encoding, Merkle roots or EIP-712
signatures; the text above is left as audited. It records how the off-chain SDK
(`@layerzerolabs/onesig-solana-sdk`, out of scope) now submits the same instructions.

- **Transaction format.** Every planned step is a Solana **v1** transaction (SIMD-0385/0296):
  **4096 bytes**, at most **64 accounts**, **12 signatures** and **64 instructions** per
  transaction. The 1232-byte figures above (Problem; Empirical limits) describe legacy/v0
  transactions. Under v1, every inline signer count up to `SIGNERS_MAX_LEN` (50) fits in one
  execute transaction with a small leaf, and far larger leaves stay inline before buffering is
  needed. Buffering remains the mechanism for payloads beyond 4096 bytes; the account-lock (64),
  instruction-trace (64) and compute limits are unchanged.
- **No address lookup tables.** v1 carries every account inline; lookup tables are not supported.
  Lookup tables only ever reduced bytes, never account locks.
- **Compute budget in config.** Compute-unit limit, heap frame and loaded-accounts data size are
  v1 transaction config fields, not ComputeBudget instructions. Each planned step states its config
  (`transactionConfig`); the planner's `transactionBytes` is the exact v1 size including that config
  and the submitter's priority fee.
- The comment in `programs/onesig/src/constants.rs` tying `SIGNERS_MAX_LEN` to a 1232-byte
  transaction is likewise historical; the constant itself is unchanged.
