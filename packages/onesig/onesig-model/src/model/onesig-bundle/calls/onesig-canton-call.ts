import { z } from 'zod';

/**
 * A 64-bit integer field (nonce / threshold / count / signed DAML `Int`). A
 * `number` must be a safe integer — larger values have already lost precision as
 * a float, so a bigint is required for values beyond `MAX_SAFE_INTEGER`.
 *
 * Defined locally so this public model package depends only on `zod`; the Canton
 * VM client (`@layerzerolabs/common-canton`, restricted) keeps its own
 * structurally-identical copy for on-ledger serde.
 */
const IntLikeSchema = z
    .union([z.bigint(), z.number()])
    .refine((value) => typeof value === 'bigint' || Number.isSafeInteger(value), {
        message: 'number must be a safe integer; pass a bigint for values beyond MAX_SAFE_INTEGER',
    });
type IntLike = z.infer<typeof IntLikeSchema>;

/**
 * Discriminant of {@link OneSigCantonCall}. The enum value is the DAML `OneSigCall`
 * constructor name (also the tag used in the Canton submission JSON), defined here
 * once so it is never hardcoded at a call site.
 */
export enum OneSigCantonCallTag {
    SetSigner = 'OpSetSigner',
    SetThreshold = 'OpSetThreshold',
    SetExecutor = 'OpSetExecutor',
    SetExecutorRequired = 'OpSetExecutorRequired',
    SetSeed = 'OpSetSeed',
    CreateRequest = 'OpCreateRequest',
    CreateOAppRequest = 'OpCreateOAppRequest',
    AddToBlacklist = 'OpAddToBlacklist',
    RemoveFromBlacklist = 'OpRemoveFromBlacklist',
    AddToWhitelist = 'OpAddToWhitelist',
    RemoveFromWhitelist = 'OpRemoveFromWhitelist',
    SetAllowlistMode = 'OpSetAllowlistMode',
    RateLimiterSetDefault = 'OpRateLimiterSetDefault',
    RateLimiterSetEidOverride = 'OpRateLimiterSetEidOverride',
    RateLimiterRemoveEidOverride = 'OpRateLimiterRemoveEidOverride',
    RateLimiterSetGlobalFlags = 'OpRateLimiterSetGlobalFlags',
    RateLimiterSetAddressExemption = 'OpRateLimiterSetAddressExemption',
    RateLimiterSetState = 'OpRateLimiterSetState',
    PauseLocalTransfers = 'OpPauseLocalTransfers',
    UnpauseLocalTransfers = 'OpUnpauseLocalTransfers',
    PauseDstEids = 'OpPauseDstEids',
    UnpauseDstEids = 'OpUnpauseDstEids',
    SetLedgerTimeValidityPeriod = 'OpSetLedgerTimeValidityPeriod',
    SetPeer = 'OpSetPeer',
    SetFeeBps = 'OpSetFeeBps',
    SetFeeDeposit = 'OpSetFeeDeposit',
    SetEnforcedOptions = 'OpSetEnforcedOptions',
    RemoveEnforcedOption = 'OpRemoveEnforcedOption',
    SetCostAsserts = 'OpSetCostAsserts',
    RemoveCostAsserts = 'OpRemoveCostAsserts',
    SetTransferRule = 'OpSetTransferRule',
    SetOfferExpiryDelayPeriod = 'OpSetOfferExpiryDelayPeriod',
    SetObservers = 'OpSetObservers',
    SetRequestFactory = 'OpSetRequestFactory',
    GrantRoles = 'OpGrantRoles',
    RevokeRoles = 'OpRevokeRoles',
    SetMinFee = 'OpSetMinFee',
    SetProtocolLedgerTimeValidityPeriod = 'OpSetProtocolLedgerTimeValidityPeriod',
    SetOneSigLedgerTimeValidityPeriod = 'OpSetOneSigLedgerTimeValidityPeriod',
}

/**
 * A Canton party, represented off-chain by its party-id text (`partyToText`),
 * e.g. `Alice::1220<fingerprint>`. This is the value hashed into the leaf, so it
 * must be the exact on-ledger party id. The Canton SDK imports this for
 * chain-local use.
 */
export const CantonPartyIdSchema = z.string();
export type CantonPartyId = z.infer<typeof CantonPartyIdSchema>;

/**
 * A DAML `Decimal` (Numeric 10) argument. Accepts a string (recommended, exact)
 * or a JS number; encoded via `formatDamlDecimal` to match DAML `show`.
 */
export const DecimalLikeSchema = z.union([z.string(), z.number()]);
export type DecimalLike = z.infer<typeof DecimalLikeSchema>;

/**
 * A DAML `Time` / `RelTime`, represented off-chain as whole **microseconds**
 * (since the unix epoch for `Time`; a duration for `RelTime`). Microseconds are
 * DAML's native precision, so an `IntLike` here reproduces the on-ledger value
 * losslessly (unlike a JS `Date`, which is millisecond-precision).
 */
export const CantonMicrosSchema = IntLikeSchema;
export type CantonMicros = IntLike;

/**
 * Identifies the OApp a config call targets, mirroring DAML `AppUID.Types.OAppId`.
 * Signed into the leaf and checked on-ledger against the supplied config.
 */
export const CantonOAppIdSchema = z.object({
    admin: CantonPartyIdSchema,
    id: z.string(),
});
export type CantonOAppId = z.infer<typeof CantonOAppIdSchema>;

/**
 * A rate-limiter config entry (DAML `RateLimitConfigEntry`): the four enable
 * flags followed by the outbound/inbound limits and windows.
 */
export const RateLimitConfigEntrySchema = z.object({
    outboundEnabled: z.boolean(),
    inboundEnabled: z.boolean(),
    netAccountingEnabled: z.boolean(),
    addressExemptionEnabled: z.boolean(),
    outboundLimit: IntLikeSchema,
    inboundLimit: IntLikeSchema,
    outboundWindow: IntLikeSchema,
    inboundWindow: IntLikeSchema,
});
export type RateLimitConfigEntry = z.infer<typeof RateLimitConfigEntrySchema>;

/**
 * Cost-assert parameters for a destination eid (DAML `CostAssertConfig`).
 * `nativeCap` is optional: `null`/omitted encodes as DAML `None`.
 */
export const CostAssertConfigSchema = z.object({
    maxPriceRatio: DecimalLikeSchema,
    maxGasPrice: IntLikeSchema,
    gasPriceScale: IntLikeSchema,
    nativeDecimalShift: IntLikeSchema,
    nativeCap: IntLikeSchema.nullish(),
    minFee: DecimalLikeSchema,
});
export type CostAssertConfig = z.infer<typeof CostAssertConfigSchema>;

/** One enforced-option entry (DAML `EnforcedOptionParam`): eid, msgType, hex options. */
export const EnforcedOptionParamSchema = z.object({
    eid: IntLikeSchema,
    msgType: IntLikeSchema,
    options: z.string(),
});
export type EnforcedOptionParam = z.infer<typeof EnforcedOptionParamSchema>;

/**
 * A protocol-scoped contract identity (DAML `Scope`): category, instance id, and
 * the authorizing admin party.
 */
export const CantonScopeSchema = z.object({
    category: z.string(),
    id: z.string(),
    admin: CantonPartyIdSchema,
});
export type CantonScope = z.infer<typeof CantonScopeSchema>;

/** One `(roleName, party)` RBAC assignment (DAML `RoleAssignment`). */
export const CantonRoleAssignmentSchema = z.object({
    roleName: z.string(),
    party: CantonPartyIdSchema,
});
export type CantonRoleAssignment = z.infer<typeof CantonRoleAssignmentSchema>;

/**
 * Allowlist mode, mirroring DAML `AllowlistMode`. Kept as a TS enum so call sites
 * can reference the members (`CantonAllowlistMode.Open`); `CantonAllowlistModeSchema`
 * validates the same values.
 */
export enum CantonAllowlistMode {
    Open = 'Open',
    Blacklist = 'Blacklist',
    Whitelist = 'Whitelist',
}

export const CantonAllowlistModeSchema = z.enum(CantonAllowlistMode);

/**
 * The encodable subset of DAML `AnyValue` used inside a `CantonCallContext`. Contract
 * ids and other non-reproducible values are intentionally absent: they cannot be
 * reproduced off-chain and are rejected by the on-ledger encoder, so they must
 * never appear in a signed context.
 *
 * `AnyValue` is recursive (`list` / `map` nest further values), so the type is
 * declared explicitly and the schema is annotated with it and built via `z.lazy`.
 */
export type AnyValue =
    | { type: 'text'; value: string }
    | { type: 'int'; value: IntLike }
    | { type: 'decimal'; value: string | number }
    | { type: 'bool'; value: boolean }
    | { type: 'party'; value: CantonPartyId }
    | { type: 'list'; value: AnyValue[] }
    | { type: 'map'; value: Record<string, AnyValue> };

export const AnyValueSchema: z.ZodType<AnyValue> = z.lazy(() =>
    z.union([
        z.object({ type: z.literal('text'), value: z.string() }),
        z.object({ type: z.literal('int'), value: IntLikeSchema }),
        z.object({ type: z.literal('decimal'), value: z.union([z.string(), z.number()]) }),
        z.object({ type: z.literal('bool'), value: z.boolean() }),
        z.object({ type: z.literal('party'), value: CantonPartyIdSchema }),
        z.object({ type: z.literal('list'), value: z.array(AnyValueSchema) }),
        z.object({ type: z.literal('map'), value: z.record(z.string(), AnyValueSchema) }),
    ]),
);

/** `argName => argValue` (DAML `CallArgs`). */
export const CantonCallArgsSchema = z.record(z.string(), AnyValueSchema);
export type CantonCallArgs = z.infer<typeof CantonCallArgsSchema>;

/** `fnSig => CallArgs` (DAML `CallFnArgs`). */
export const CantonCallFnArgsSchema = z.record(z.string(), CantonCallArgsSchema);
export type CantonCallFnArgs = z.infer<typeof CantonCallFnArgsSchema>;

/** `target.address => CallFnArgs` (DAML `CallContractArgs`; key is the address text). */
export const CantonCallContractArgsSchema = z.record(z.string(), CantonCallFnArgsSchema);
export type CantonCallContractArgs = z.infer<typeof CantonCallContractArgsSchema>;

/** `target.name => CallContractArgs` (DAML `CallTargetArgs`). */
export const CantonCallTargetArgsSchema = z.record(z.string(), CantonCallContractArgsSchema);
export type CantonCallTargetArgs = z.infer<typeof CantonCallTargetArgsSchema>;

/** `caller.address => CallTargetArgs` (DAML `CallCallerArgs`; key is the address text). */
export const CantonCallCallerArgsSchema = z.record(z.string(), CantonCallTargetArgsSchema);
export type CantonCallCallerArgs = z.infer<typeof CantonCallCallerArgsSchema>;

/**
 * The six-level nested call context, mirroring DAML `Call.CallContext`:
 *   caller.name => caller.address => target.name => target.address => fnSig => argName => argValue
 * Address-keyed levels (caller.address, target.address) use the address text as
 * the key; only text addresses are encodable.
 */
export const cantonCallContextSchema = z.record(z.string(), CantonCallCallerArgsSchema);
export type CantonCallContext = z.infer<typeof cantonCallContextSchema>;

/**
 * Flat SDK representation of a signed OneSig call. Field names mirror the DAML
 * `OneSigCall` constructors. This is the value hashed into the Merkle leaf — it is
 * NOT the Canton submission (DAML-LF JSON) shape, which is built separately.
 */
export const oneSigCantonCallSchema = z.discriminatedUnion('tag', [
    z.object({
        tag: z.literal(OneSigCantonCallTag.SetSigner),
        signer: z.string().regex(/^0x[0-9a-f]{40}$/),
        active: z.boolean(),
    }),
    z.object({ tag: z.literal(OneSigCantonCallTag.SetThreshold), newThreshold: IntLikeSchema }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.SetExecutor),
        executor: CantonPartyIdSchema,
        active: z.boolean(),
    }),
    z.object({ tag: z.literal(OneSigCantonCallTag.SetExecutorRequired), required: z.boolean() }),
    z.object({ tag: z.literal(OneSigCantonCallTag.SetSeed), newSeed: z.string() }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.CreateRequest),
        callContext: cantonCallContextSchema,
        callbackContext: cantonCallContextSchema,
        feeAmount: z.union([z.string(), z.number()]),
        dso: CantonPartyIdSchema,
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.AddToBlacklist),
        oappId: CantonOAppIdSchema,
        parties: z.array(CantonPartyIdSchema),
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.RemoveFromBlacklist),
        oappId: CantonOAppIdSchema,
        parties: z.array(CantonPartyIdSchema),
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.AddToWhitelist),
        oappId: CantonOAppIdSchema,
        parties: z.array(CantonPartyIdSchema),
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.RemoveFromWhitelist),
        oappId: CantonOAppIdSchema,
        parties: z.array(CantonPartyIdSchema),
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.SetAllowlistMode),
        oappId: CantonOAppIdSchema,
        newMode: CantonAllowlistModeSchema,
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.CreateOAppRequest),
        oappId: CantonOAppIdSchema,
        callContext: cantonCallContextSchema,
        callbackContext: cantonCallContextSchema,
        requestObservers: z.array(CantonPartyIdSchema),
        feeAmount: DecimalLikeSchema,
        dso: CantonPartyIdSchema,
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.RateLimiterSetDefault),
        oappId: CantonOAppIdSchema,
        newDefaultConfig: RateLimitConfigEntrySchema,
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.RateLimiterSetEidOverride),
        oappId: CantonOAppIdSchema,
        eid: IntLikeSchema,
        newConfig: RateLimitConfigEntrySchema,
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.RateLimiterRemoveEidOverride),
        oappId: CantonOAppIdSchema,
        eid: IntLikeSchema,
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.RateLimiterSetGlobalFlags),
        oappId: CantonOAppIdSchema,
        newUseGlobalState: z.boolean(),
        newIsGloballyDisabled: z.boolean(),
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.RateLimiterSetAddressExemption),
        oappId: CantonOAppIdSchema,
        user: CantonPartyIdSchema,
        isExempt: z.boolean(),
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.RateLimiterSetState),
        oappId: CantonOAppIdSchema,
        eid: IntLikeSchema,
        outboundUsage: IntLikeSchema,
        inboundUsage: IntLikeSchema,
        lastUpdated: CantonMicrosSchema,
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.PauseLocalTransfers),
        oappId: CantonOAppIdSchema,
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.UnpauseLocalTransfers),
        oappId: CantonOAppIdSchema,
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.PauseDstEids),
        oappId: CantonOAppIdSchema,
        dstEids: z.array(IntLikeSchema),
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.UnpauseDstEids),
        oappId: CantonOAppIdSchema,
        dstEids: z.array(IntLikeSchema),
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.SetLedgerTimeValidityPeriod),
        oappId: CantonOAppIdSchema,
        newLedgerTimeValidityPeriod: CantonMicrosSchema,
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.SetPeer),
        oappId: CantonOAppIdSchema,
        eid: IntLikeSchema,
        peer: z.string(),
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.SetFeeBps),
        oappId: CantonOAppIdSchema,
        dstEid: IntLikeSchema,
        feeBps: IntLikeSchema,
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.SetFeeDeposit),
        oappId: CantonOAppIdSchema,
        newFeeDeposit: CantonPartyIdSchema,
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.SetEnforcedOptions),
        oappId: CantonOAppIdSchema,
        params: z.array(EnforcedOptionParamSchema),
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.RemoveEnforcedOption),
        oappId: CantonOAppIdSchema,
        eid: IntLikeSchema,
        msgType: IntLikeSchema,
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.SetCostAsserts),
        oappId: CantonOAppIdSchema,
        eid: IntLikeSchema,
        config: CostAssertConfigSchema,
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.RemoveCostAsserts),
        oappId: CantonOAppIdSchema,
        eid: IntLikeSchema,
    }),
    z.object({ tag: z.literal(OneSigCantonCallTag.SetTransferRule), oappId: CantonOAppIdSchema }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.SetOfferExpiryDelayPeriod),
        oappId: CantonOAppIdSchema,
        newOfferExpiryDelayPeriod: CantonMicrosSchema,
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.SetObservers),
        oappId: CantonOAppIdSchema,
        newObservers: z.array(CantonPartyIdSchema),
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.SetRequestFactory),
        oappId: CantonOAppIdSchema,
        expectedHandler: CantonPartyIdSchema,
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.GrantRoles),
        scope: CantonScopeSchema,
        assignments: z.array(CantonRoleAssignmentSchema),
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.RevokeRoles),
        scope: CantonScopeSchema,
        assignments: z.array(CantonRoleAssignmentSchema),
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.SetMinFee),
        scope: CantonScopeSchema,
        newMinFee: DecimalLikeSchema,
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.SetProtocolLedgerTimeValidityPeriod),
        scope: CantonScopeSchema,
        newLedgerTimeValidityPeriod: CantonMicrosSchema,
    }),
    z.object({
        tag: z.literal(OneSigCantonCallTag.SetOneSigLedgerTimeValidityPeriod),
        newLedgerTimeValidityPeriod: CantonMicrosSchema,
    }),
]);
export type OneSigCantonCall = z.infer<typeof oneSigCantonCallSchema>;
