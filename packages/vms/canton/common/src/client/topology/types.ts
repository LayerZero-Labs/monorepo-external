import {
    type Enums_ParticipantPermission,
    type GenerateTransactionsResponse_GeneratedTransaction,
} from '@canton-network/core-ledger-proto';
import type { ClientOptions } from '@grpc/grpc-js';

import type { TokenProvider } from '../../auth/token-provider';

/** Unsigned topology transaction from `GenerateTransactions` (`serializedTransaction`, `transactionHash`). */
export type GeneratedTopologyTransaction = GenerateTransactionsResponse_GeneratedTransaction;

/** Inputs for building an unsigned Namespace Delegation topology transaction. */
export type CreateNamespaceDelegationTxParams = {
    /** DER-encoded secp256k1 public key (X.509 SubjectPublicKeyInfo). Namespace is derived from its fingerprint. */
    publicKeyDer: Uint8Array;
    /** Topology serial (default: 0 = auto-determined by Canton). */
    serial?: number;
};

/** Inputs for building an unsigned Decentralized Namespace Definition topology transaction. */
export type CreateDecentralizedNamespaceDefinitionTxParams = {
    /** Owner key fingerprints (multihash hex). Namespace id is derived from these. */
    owners: string[];
    /** Signing threshold (≤ number of owners). */
    threshold: number;
    /** Topology serial (default: 0 = auto-determined by Canton). */
    serial?: number;
};

export type UpdateDecentralizedNamespaceDefinitionTxParams =
    CreateDecentralizedNamespaceDefinitionTxParams & {
        namespace: string;
    };

/** Inputs for building an unsigned Party-to-Key mapping topology transaction. */
export type CreatePartyToKeyMappingTxParams = {
    /** Full party id (e.g. `hint::1220…`). */
    partyId: string;
    /** DER-encoded signing public keys. */
    signingPublicKeyDers: Uint8Array[];
    /** Signing threshold (≤ number of keys). */
    threshold: number;
    /** Topology serial (default: 0 = auto-determined by Canton). */
    serial?: number;
};

/** Inputs for building an unsigned Party-to-Participant topology transaction. */
export type CreatePartyToParticipantMappingTxParams = {
    /** Full party id (e.g. `hint::1220…`). */
    partyId: string;
    /** Hosting participant id(s). */
    participantIds: string[];
    /** Hosting threshold (≤ number of participants). */
    threshold: number;
    /** Topology serial (default: 0 = auto-determined by Canton). */
    serial?: number;
};

/** Namespace Delegation (NSD) as returned by topology list queries. */
export type NamespaceDelegationState = {
    /** Namespace fingerprint this delegation applies to. */
    namespace: string;
    /** Fingerprint of the key receiving delegation authority. */
    targetKeyFingerprint: string;
    /** DER (X.509 SubjectPublicKeyInfo) public key receiving delegation authority. */
    targetPublicKeyDer: Uint8Array;
    /** Whether this is a root (self) namespace delegation. */
    isRootDelegation: boolean;
    /** Topology serial of this mapping revision. */
    serial: number;
};

/** Decentralized Namespace Definition (DND) as returned by topology list queries. */
export type DecentralizedNamespaceDefinitionState = {
    /** Decentralized namespace fingerprint. */
    namespace: string;
    /** Minimum number of owner signatures required. */
    threshold: number;
    /** Owner namespace fingerprints (multihash hex). */
    owners: string[];
    /** Topology serial of this mapping revision. */
    serial: number;
    /** Hex-encoded topology transaction hash of this revision (when returned by the node). */
    transactionHash?: string;
    /** Fingerprints of the keys that have signed this revision (useful for pending proposals). */
    signedByFingerprints?: string[];
};

/** Party-to-Key (PTK) mapping as returned by topology list queries. */
export type PartyToKeyMappingState = {
    /** Full party identifier. */
    party: string;
    /** Minimum number of signing keys required. */
    threshold: number;
    /** Fingerprints of keys authorized to sign for the party. */
    signingKeyFingerprints: string[];
    /** Topology serial of this mapping revision. */
    serial: number;
    /** Hex-encoded topology transaction hash of this revision (when returned by the node). */
    transactionHash?: string;
    /** Fingerprints of the keys that have signed this revision (useful for pending proposals). */
    signedByFingerprints?: string[];
};

/** Party-to-Participant (PTP) mapping as returned by topology list queries. */
export type PartyToParticipantMappingState = {
    /** Full party identifier. */
    party: string;
    /** Hosting threshold (≤ number of participants). */
    threshold: number;
    /** Participant nodes hosting the party and their permission. */
    participants: { participantUid: string; permission: Enums_ParticipantPermission }[];
    /** Topology serial of this mapping revision. */
    serial: number;
};

/** Options for constructing a {@link CantonGrpcClient}. */
export type CantonGrpcClientOptions = {
    /** Participant admin API host (e.g. `participant.example.com:443`). */
    host: string;
    /** Supplies a fresh Bearer token before each RPC call. */
    tokenProvider: TokenProvider;
    /**
     * Logical synchronizer id used as the topology store. When omitted, the first
     * synchronizer the participant is connected to (via `ListConnectedSynchronizers`)
     * is resolved on the first RPC.
     */
    synchronizerId?: string;
    /** Drops transport encryption; loopback hosts only. Defaults to TLS. */
    insecureTransport?: boolean;
    /** Overrides the default gRPC channel options. */
    grpcClientOptions?: ClientOptions;
};
