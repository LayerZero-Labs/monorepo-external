import type { ContractId, Party } from '@daml/types';
import { z } from 'zod';

/**
 * A 64-bit integer field (oneSigId / nonce / threshold / count / signed `Int`).
 * A `number` must be a safe integer — larger values have already lost precision as
 * a float, so a bigint is required (mirrors the {@link toBigInt} runtime guard).
 */
export const IntLikeSchema = z
    .union([z.bigint(), z.number()])
    .refine((value) => typeof value === 'bigint' || Number.isSafeInteger(value), {
        message: 'number must be a safe integer; pass a bigint for values beyond MAX_SAFE_INTEGER',
    });
export type IntLike = z.infer<typeof IntLikeSchema>;

/**
 * Core Types
 */
export type TemplateId = string;

/**
 * Build a Canton template ID from a package ID and module path.
 *
 * @example buildTemplateId('abc123', 'RequestFactory:RequestFactory')
 * // => 'abc123:RequestFactory:RequestFactory'
 */
export const buildTemplateId = (packageId: string, modulePath: string): TemplateId =>
    `${packageId}:${modulePath}`;

// '1' → '0.0000000001' (Canton Coin has 10 decimals)
export const smallestUnitsToDamlDecimal = (units: string): string => {
    if (units.startsWith('-')) {
        throw new Error(`smallestUnitsToDamlDecimal: negative value not supported: ${units}`);
    }
    const padded = units.padStart(11, '0');
    return `${padded.slice(0, -10).replace(/^0+/, '') || '0'}.${padded.slice(-10)}`;
};

// '0.01' → '0.0100000000' — pads to exactly 10 fractional digits for ledger comparison
export const canonicalizeDamlDecimal = (value: string): string => {
    const [integer = '0', fraction = ''] = value.split('.');
    return `${integer}.${fraction.padEnd(10, '0')}`;
};

export type Contract<T extends object> = {
    templateId: TemplateId;
    contractId: ContractId<T>;
    payload: T;
};

/**
 * Submission Types
 */
export type SubmitActors = {
    actAs: Party[];
    readAs?: Party[];
};

export type SubmitResult = {
    commandId: string;
    completionOffset: number;
};

/**
 * Wait / Reconciliation Types
 */
export const CommandStatus = {
    Accepted: 'accepted',
    Rejected: 'rejected',
    Timeout: 'timeout',
} as const;

export type CommandStatus = (typeof CommandStatus)[keyof typeof CommandStatus];

export type WaitAccepted = {
    status: typeof CommandStatus.Accepted;
    commandId: string;
    updateId: string;
    offset: number;
};
export type WaitRejected = {
    status: typeof CommandStatus.Rejected;
    commandId: string;
    offset: number;
    error: { code?: number; message: string; details?: unknown };
};
type WaitTimeout = {
    status: typeof CommandStatus.Timeout;
    commandId: string;
    lastCheckedOffset?: number;
};

export type WaitResult = WaitAccepted | WaitRejected | WaitTimeout;

export type WaitWithExpiryResult = WaitResult | { status: 'expired'; commandId: string };

export type WaitOptions = {
    parties: Party[];
    beginExclusive?: number;
    timeoutMs?: number;
    poll?: {
        limit?: number;
        streamIdleTimeoutMs?: number;
        backoffMs?: { initial: number; max: number };
    };
};

/**
 * External Party / Interactive Submission Types
 */

/**
 * A prepared transaction ready for external signing.
 */
export type PreparedTransaction = {
    /** The transaction blob to sign */
    preparedTransaction: string;
    /** Hash of the transaction (sign this) */
    preparedTransactionHash: string;
    /** Hashing scheme version used */
    hashingSchemeVersion: 'HASHING_SCHEME_VERSION_UNSPECIFIED' | 'HASHING_SCHEME_VERSION_V2';
    /** Command ID for tracking */
    commandId: string;
};

export const cantonCommandExpirySchema = z.object({
    maxRecordTime: z.string(),
    synchronizerId: z.string(),
    participantId: z.string(),
    userId: z.string(),
    completionOffset: z.number(),
});
export type CantonCommandExpiry = z.infer<typeof cantonCommandExpirySchema>;

export type PreparedTransactionWithExpiry = Omit<PreparedTransaction, 'hashingSchemeVersion'> & {
    hashingSchemeVersion: 'HASHING_SCHEME_VERSION_V3';
    expiry: CantonCommandExpiry;
};

export type ExternalSignature = {
    /** The party that signed */
    party: Party;
    /** The signature bytes (base64 or hex) */
    signature: string;
    /** Fingerprint/ID of the signing key */
    signedBy: string;
    /** Signature format (e.g., 'Raw') */
    format: string;
    /** Signing algorithm (e.g., 'Ed25519') */
    signingAlgorithmSpec: string;
};

/**
 * A right granted to a Canton user, as returned by `/v2/users/{userId}/rights`.
 *
 * The `kind` is a discriminated union — only one variant is set per right:
 *  - `CanActAs.value.party`: user can submit transactions as that party
 *  - `CanReadAs.value.party`: user can read events visible to that party
 *  - `ParticipantAdmin`: user has admin rights on the participant
 *  - `IdentityProviderAdmin`: user can administer its identity provider
 *  - `CanReadAsAnyParty`: user can read as any party
 *  - `CanExecuteAsAnyParty`: user can submit as any party
 *
 * Hand-rolled because the OpenAPI generator's `Kind` converter is broken
 * (`instanceOfKindOneOf` checks lowercase `canActAs`, but `KindOneOfFromJSON`
 * reads uppercase `CanActAs`), so the typed client strips all party data.
 *
 * The four nullary variants carry `value: unknown` because Canton's wire
 * format for them is literally `{ "value": {} }` (see
 * https://docs.digitalasset.com/build/3.4/explanations/json-api/) and we
 * never read into that payload — only the presence of the variant matters.
 */
export type UserRightKind = {
    CanActAs?: { value: { party: string } };
    CanReadAs?: { value: { party: string } };
    ParticipantAdmin?: { value: unknown };
    IdentityProviderAdmin?: { value: unknown };
    CanReadAsAnyParty?: { value: unknown };
    CanExecuteAsAnyParty?: { value: unknown };
};

export type UserRight = {
    kind: UserRightKind;
};

/** Normalized active contract (flat shape derived from JsActiveContract). */
export type NormalizedActiveContract = {
    contractId: string;
    templateId: string;
    payload: unknown;
    synchronizerId: string;
};
