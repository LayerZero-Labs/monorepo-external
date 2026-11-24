---
owner: Protocol team
reviewed: 2026-10-01
---

# Canton refresh plans

A transaction producer or activity can attach a `refreshPlan` to
`CantonPopulatedTransaction` when command inputs may become stale before signing. Low-level SDK
command builders produce concrete Canton commands with current values. Opt-in population helpers
may attach declarative refresh plans, which the common engine resolves before preparation and
signing.

At sign time, the common Canton transaction layer:

1. clones `unresolvedCommands`;
2. binds the assigned sender at explicitly declared sender-sentinel targets;
3. resolves each refresh against current ledger, wallet, or clock state;
4. applies replacements only to the declared command targets;
5. preserves original populated disclosures and merges resolver disclosures by CID; and
6. validates the bound identity and passes the resulting `commands` and `disclosedContracts` to
   `prepareForSigning`.

The persisted unresolved values remain the immutable baseline. A `refreshPlan` permits
`cantonSenderPartyRef()` only at explicitly declared argument targets. All other command sentinels
are rejected, including sentinels introduced by fresh data. Transactions without a plan use the same
command validation and disclosure merge rules without performing dependency reads. Deployment
address references remain identity lookup inputs; they are not substituted inside transactions.

## Shared request population

`@layerzerolabs/canton-contract-sdks` exports `prepareRefreshableRequestCreate` and
`requestCreateRefreshPlan`. Callers can opt into the concrete request builder through the existing
contract-client hook:

```ts
import { prepareRefreshableRequestCreate } from '@layerzerolabs/canton-contract-sdks';
import { getDvnContract } from '@layerzerolabs/lzver-contract-client';

const client = getDvnContract(address, {
    ...deps,
    prepareRequestCreate: (callContext) =>
        prepareRefreshableRequestCreate(deps, callContext, { senderParty: fundingParty }),
});
```

This helper requires a known, concrete funding party during population. It preserves the supplied
call and optional callback contexts while refreshing the request factory, config, current minimum
fee, sufficient Amulet funding, Amulet context, and timestamp. Late-sender funding and legacy
sentinels inside call contexts are not supported by this helper. Write methods require the
preparation hook; read-only clients may omit it. Migrated worker imports re-export the same shared builder.

## Shared Amulet wallet-transfer population

`@layerzerolabs/common-canton` exports `prepareRefreshableAmuletTransfer` for native Amulet (CC)
transfers:

```ts
const populatedTransaction = await prepareRefreshableAmuletTransfer({
    client,
    receiverParty,
    amount: '2.5',
});
```

The helper populates a concrete Wallet context, ExternalPartyAmuletRules CID, original disclosures,
receiver, and amount. It declares late sender binding and intentionally starts with
`inputHoldingCids: []`: this is an explicit initial-funding exception, not an executable transfer.
The transaction flow must resolve the plan with the assigned sender before preparation or signing.
Resolution selects the assigned sender's owner-matching Amulet holdings authenticated by the DSO
signatory until their summed `amount.initialAmount` is at least the transfer amount, using the existing
`gte` selector. Each resolution replaces the entire holding-CID array; the number of selected holdings
can change between attempts. No matching holdings or an insufficient total fails before preparation.
The selector considers larger positive holdings first and rejects selections needing more than 100
inputs. This checks stored initial amounts, not current spendable value after holding fees or
transaction costs; it does not guarantee fee-adjusted funding.

The Wallet context is fetched for the transfer's receiver and amount, both when populating and on
each refresh, so a receiver with a TransferPreapproval gets its preapproval in the context and the
transfer executes directly instead of becoming a pending transfer instruction. A refresh whose
preapproval expires within five minutes uses the generic probe's context instead, so the transfer
becomes an offer.
The plan refreshes the factory CID and context from one Wallet response, and refreshes `requestedAt`
and `executeBefore` after external reads with a 24-hour interval. Receiver, amount, instrument,
metadata, and lock remain unchanged. The helper leaves `actAs` empty for the transaction flow to
assign. Production wallet and faucet callers adopt this helper separately.

## Shared transfer-instruction acceptance

`prepareRefreshableTransferInstructionAcceptance({ client, partyId, contractId })` from
`@layerzerolabs/common-canton` populates one concrete `TransferInstruction_Accept` command and
its Wallet context/disclosures. Optional `packageVettingParties` selects the parties used for
interface package lookup and defaults to `[partyId]`; it does not change `actAs`.
Its plan refreshes only `extraArgs.context` for that exact
instruction CID; it never enumerates or selects another pending instruction. The client requires
Wallet configuration and obtains a token for each context read. The instruction, acting party,
metadata and original disclosures remain fixed across rebuilds. Provider or ledger failures for
expired or archived instructions propagate; the helper does not preflight their remaining lifetime.
Production callers adopt this helper separately.

## Shared callback population

`ExecutorSdk.prepareRefreshableFinalizeCallback({ pendingCallbackCid })` populates a concrete
Executor command and refresh plan for OftSelf, lock/unlock, and burn/mint callbacks. Each
resolution rereads the pinned PendingCallback and rebuilds the callback CID, complete execution
context, and disclosures from current dependencies. The Executor is refreshed separately.

The pending CID, OApp and handler, adapter kind, instrument, local/shared/rate-limiter scale
decimals, and treasury or mint escrow remain fixed. Changes require repopulation; dependency
CIDs and operational configuration may refresh. Burn/mint escrow holdings are registry probe
inputs only; the on-chain transfer uses newly minted outputs.

Adapter callbacks resolve the instrument's CIP-56 registry context as follows. Canonical Amulet
uses only the validator wallet's scan-proxy. Other instruments try the OApp's DiscoveryRegistry
URL for its app UID, then DA Utilities' registrar for the instrument admin (mainnet and testnet
only). A missing or ambiguous URL, or any probe or disclosure failure, moves on to the next
registry, and the final error lists each reason; activity retries rerun every path. Burn/mint
never accepts Amulet. OftSelf callbacks need no registry. Treasury and mint-escrow inputs are the
largest holdings, capped at Splice's 100 `maxNumInputs`.

## Binding a late-assigned sender

A producer that does not yet know the transaction sender can put `cantonSenderPartyRef()` at
specific command argument locations and declare them alongside its freshness commands:

```ts
replaceSentinels: [
    {
        kind: 'senderParty',
        targets: [
            {
                commandIndex: 0,
                command: 'exercise',
                choice: 'Transfer',
                arguments: [{ path: [{ field: 'sender' }] }],
            },
        ],
    },
],
```

Binding uses the transaction's already-assigned `senderParty`; it does not select a sender or query
the ledger. Every declared target must contain the exact `cantonSenderPartyRef()` value. A missing,
empty, whitespace-only, or sentinel sender fails before dependency reads, as do malformed targets,
concrete target values, duplicate binding locations, and undeclared sentinels. Sender strings are
not normalized. Targets use the same guarded exercise/create argument paths described below;
exercise contract IDs cannot be sender targets. At least one freshness command is still required.

After all freshness updates, each binding target must still contain the assigned sender. A refresh
that replaces its parent may preserve that identity, but a changed or missing sender fails before
preparation or signing. Each rebuild binds a fresh copy of the original commands; success and
failure leave the populated inputs unchanged. Disclosure data is opaque to command sentinel
validation.

## Defining a plan

```ts
const populatedTransaction: CantonPopulatedTransaction = {
    unresolvedCommands: prepared.commands,
    unresolvedDisclosedContracts: prepared.disclosedContracts,
    actAs: prepared.actAs,
    refreshPlan: {
        commands: [
            {
                resolver: {
                    type: 'activeContract',
                    selector: {
                        queryAs: { party: executorParty },
                        templateId: '#layerzero-executor:Executor:Executor',
                        expectedSignatories: [executorParty],
                    },
                    selection: { kind: 'exactlyOne' },
                },
                targets: [
                    {
                        commandIndex: 0,
                        command: 'exercise',
                        field: 'contractId',
                    },
                ],
            },
            {
                resolver: {
                    type: 'timestamp',
                },
                targets: [
                    {
                        commandIndex: 0,
                        command: 'exercise',
                        choice: 'DelegateLzReceive',
                        arguments: [{ path: [{ field: 'timestamp' }] }],
                    },
                ],
            },
        ],
    },
};
```

`refreshPlan.commands` contains the instructions that resolve and patch volatile Canton command
values. Each instruction groups one `resolver` with every command target that consumes its output,
so external reads and correlated timestamps are shared. Some resolvers also emit the fresh
disclosures required by their values.

`commandIndex` selects an entry in `unresolvedCommands`. `command` validates that the entry has the
required create or exercise shape. Each target groups its nested `arguments` under one guarded
command: exercise targets require `choice`, while create targets require `template`.
An exercise `contractId` target is a separate variant with an optional `choice` guard. When
provided, `choice` must match the command before its contract ID is replaced; omitting it preserves
the index and exercise-shape checks without checking the choice.

Nested paths support:

- `{ field: 'name' }` for object fields;
- `{ index: 0 }` for array entries; and
- `{ damlMapKey: 'timestamp' }` for entries in Daml maps represented as key-value tuples.

Path segments can be mixed and repeated, so nested Daml maps use consecutive `damlMapKey` segments.
Timestamp `offsetMs` is configured per argument.

An `activeContract` refresh with `selection.kind: 'exactlyOne'` can target an exercise `contractId`.
Collection-valued `activeContract` selections target choice or create arguments. An `amuletContext`
entry requires argument `targets` for the context and can additionally declare `contractIdTargets`
for the ExternalPartyAmuletRules CID from the same Wallet bundle:

```ts
contractIdTargets: [{ commandIndex: 0, command: 'exercise', field: 'contractId' }],
```

These CID targets use the same index and exercise-shape guards as other exercise `contractId`
targets. Omitting them preserves context-only refresh behavior. Timestamp refreshes also require a
non-empty nested argument path.

Selectors specify exactly one of `templateId` or `interfaceId`. Template selectors filter create
arguments; interface selectors filter the matching successful interface view. Both authenticate
ledger signatories before counting matches. Use dotted scalar paths for composite identities.
Name-qualified interfaces (`#package:Module:Interface`) resolve to the visibility party's preferred
vetted package ID on each refresh, and both the ACS query and view matching use that exact ID.
Package-qualified selectors use their exact ID directly. A different package with the same module
and entity names cannot satisfy the selector. Duplicate views, including a failed view alongside a
successful one, fail closed. A newly preferred package is used on the next refresh; contracts that
only implement an older interface package do not match it and require an explicit supported package
selector rather than an automatic fallback across versions.

A selector may restrict its CID to `{ contractId: { selector, field } }`, reading a nonempty CID
from exactly one authenticated source contract's create arguments. The source selector cannot
itself contain a linked CID. Source lookups share the per-resolution query cache, so a rotated
config and the contract it references remain paired; an absent referenced contract fails closed.
An `activeContract` / `exactlyOne` entry with `targets: []` refreshes only disclosures.

## Command resolvers

- `finalizeCallback`: rebuilds the complete context and callback CID for a pinned PendingCallback
  with fixed economic identity; supports OftSelf, lock/unlock, and burn/mint.

- `activeContract`: queries authenticated active contracts, then selects `exactlyOne`, `all`, or
  enough contracts for a numeric field to be greater than or equal to a requested value:
  `{ kind: 'gte', field: 'amount', value: feeAmount }`.
- `activeContractValue`: selects exactly one authenticated contract and projects a positive Daml
  Decimal field into choice or create arguments: `{ type: 'activeContractValue', selector,
field: 'minFee' }`. Missing, malformed, zero, or negative values fail closed.
- `amuletContext`: refreshes the wallet-provided context, ExternalPartyAmuletRules CID, and
  disclosures. Optional `receiver` and `amount` probe the Wallet for that transfer, which includes
  the receiver's TransferPreapproval; without them it probes a zero-amount admin self-transfer.
  Set `receiver` only when the context serves a single transfer to that receiver: Splice aborts a
  transfer whose context carries another receiver's preapproval, so a context shared by transfers
  to different receivers must use the probe. When the receiver context carries a
  `transfer-preapproval` whose disclosure's `debugPayload.expiresAt` is within five minutes by the
  local clock, the resolver warns and uses the probe's context, ExternalPartyAmuletRules CID and
  disclosures instead. A missing or non-Time `expiresAt` keeps the receiver context. The probe's
  context replaces the whole target, so no `transfer-preapproval` value survives from population;
  the populated preapproval disclosure is retained but unused.
- `transferInstructionAcceptContext`: fetches fresh Wallet acceptance context and disclosures for
  the pinned instruction CID, targeting only `TransferInstruction_Accept` at `extraArgs.context`.
- `timestamp`: refreshes one or more Canton Time values from the same current instant; `offsetMs`
  can derive an expiry from that instant. Timestamp refreshes run after all ledger and wallet
  refreshes regardless of declaration order.

`gte.field` may be a dotted create-argument path. Its value may be a Daml Decimal string or an
Amulet-style record containing `initialAmount`. The requested `gte.value` accepts either a positive
Decimal string or `{ selector, field }`, which reads a positive Decimal from exactly one authenticated
contract. Use the identical selector for its CID, projected value, and dependent funding threshold;
they share a cached ledger query within each resolution. Each subsequent resolution reads fresh state.

All original populated disclosures are retained, including those no longer referenced by the
refreshed commands. Resolver disclosures are merged by CID: identical records are deduplicated,
and conflicting records for the same CID fail. Active-contract queries always request
`createdEventBlob`.

Each rebuild resolves the original populated commands, disclosures, and plan again. If the original
disclosures contain `rules-v1`, a first resolution adds `rules-v2`, and a rebuild resolves `rules-v3`,
the rebuild retains `rules-v1` and adds `rules-v3`; it does not carry over `rules-v2`.

Keep `queryAs` (ledger visibility) separate from `expectedSignatories` (authority), and use
`stateFilter` for semantic payload identity such as an owner. Missing filter paths fail closed.

## OneSig execution

The additive [OneSig SDK](../../../../../onesig/onesig-canton/README.md) populates all supported
operation families with concrete contexts and declared refresh entries. `oneSigRequestContext`,
`oneSigConfigContext`, `oneSigScopeContext` and `oneSigDiscoveryContext` refresh unsigned domain
dependencies while preserving signed identity and parameters. `oneSigTransferInstructionContext`
pins the selected instruction and refreshes its provider context without changing signed times.

`oneSigRequestContext`, `oneSigConfigContext` and `oneSigScopeContext` read the ledger as
`informee` plus any parties in `readAs`, so they can see protocol contracts `informee` cannot, such
as a request factory and its config signed by the handler. Package lookups use only `informee`. An
entry without `readAs` reads as `informee` alone.

`oneSigTransferBatch` covers every Transfer context in one command exactly once. It independently
selects aggregate OneSig-admin-owned holdings per instrument; existing executor fee entries remain
separate. Each actual transfer probe obtains its own coherent timestamp and provider context,
including exact microsecond expiry. Those timestamps are excluded from the final timestamp pass.
All entries retain the original-disclosure and baseline-rebuild semantics described above.
