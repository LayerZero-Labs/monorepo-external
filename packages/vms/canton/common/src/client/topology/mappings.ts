import {
    CryptoKeyFormat,
    DecentralizedNamespaceDefinition,
    Enums_ParticipantPermission,
    NamespaceDelegation,
    PartyToKeyMapping,
    PartyToParticipant,
    PartyToParticipant_HostingParticipant,
    SigningKeySpec,
    SigningKeyUsage,
    SigningPublicKey,
    TopologyMapping,
} from '@canton-network/core-ledger-proto';

import { computePublicKeyFingerprint } from '../utils';

/**
 * Builds a Canton protocol `SigningPublicKey` from a DER-encoded secp256k1 public key.
 *
 * Keys use X.509 SubjectPublicKeyInfo encoding with `NAMESPACE` and `PROTOCOL` usage,
 * as required by Canton topology mappings.
 *
 * @param publicKeyDer - DER-encoded secp256k1 public key (X.509 SubjectPublicKeyInfo).
 * @returns A `SigningPublicKey` for use in topology mapping protobuf fields.
 */
function buildSigningPublicKey(publicKeyDer: Uint8Array): SigningPublicKey {
    return SigningPublicKey.create({
        format: CryptoKeyFormat.DER_X509_SUBJECT_PUBLIC_KEY_INFO,
        publicKey: publicKeyDer,
        usage: [SigningKeyUsage.NAMESPACE, SigningKeyUsage.PROTOCOL],
        keySpec: SigningKeySpec.EC_SECP256K1,
    });
}

/**
 * Builds a Namespace Delegation (NSD) topology mapping for a root owner key.
 *
 * Registers a self-rooted namespace: the namespace identifier is the public key
 * fingerprint, and the same key is the root delegation target. The unsigned
 * transaction produced from this mapping must be signed by that key alone.
 *
 * @param publicKeyDer - DER-encoded secp256k1 public key for the namespace owner.
 * @returns A `TopologyMapping` containing a root `NamespaceDelegation`.
 */
export function buildNamespaceDelegationMapping(publicKeyDer: Uint8Array): TopologyMapping {
    const namespace = computePublicKeyFingerprint(publicKeyDer);
    return TopologyMapping.create({
        mapping: {
            oneofKind: 'namespaceDelegation',
            namespaceDelegation: NamespaceDelegation.create({
                namespace,
                targetKey: buildSigningPublicKey(publicKeyDer),
                isRootDelegation: true,
            }),
        },
    });
}

/**
 * Builds a Decentralized Namespace Definition (DND) topology mapping.
 *
 * Defines a multi-owner namespace identified by `decentralizedNamespace`, with a
 * signing threshold over the listed owner key fingerprints. Every owner must
 * authorize the transaction.
 *
 * @param decentralizedNamespace - Decentralized namespace fingerprint (e.g. `1220…`).
 * @param threshold - Minimum number of owner signatures required (≤ `owners.length`).
 * @param owners - Owner namespace fingerprints (multihash hex strings).
 * @returns A `TopologyMapping` containing a `DecentralizedNamespaceDefinition`.
 */
export function buildDecentralizedNamespaceDefinitionMapping(
    decentralizedNamespace: string,
    threshold: number,
    owners: string[],
): TopologyMapping {
    return TopologyMapping.create({
        mapping: {
            oneofKind: 'decentralizedNamespaceDefinition',
            decentralizedNamespaceDefinition: DecentralizedNamespaceDefinition.create({
                decentralizedNamespace,
                threshold,
                owners,
            }),
        },
    });
}

/**
 * Builds a Party-to-Key (PTK) topology mapping.
 *
 * Binds signing keys to a party and sets the threshold required to authorize
 * party-level topology changes. Decentralized namespace owners must co-sign
 * the transaction.
 *
 * @param partyId - Full party identifier (e.g. `hint::1220…`).
 * @param signingPublicKeyDers - DER-encoded signing public keys assigned to the party.
 * @param threshold - Minimum number of party signing keys required (≤ number of keys).
 * @returns A `TopologyMapping` containing a `PartyToKeyMapping`.
 */
export function buildPartyToKeyMapping(
    partyId: string,
    signingPublicKeyDers: Uint8Array[],
    threshold: number,
): TopologyMapping {
    return TopologyMapping.create({
        mapping: {
            oneofKind: 'partyToKeyMapping',
            partyToKeyMapping: PartyToKeyMapping.create({
                party: partyId,
                threshold,
                signingKeys: signingPublicKeyDers.map((publicKeyDer) =>
                    buildSigningPublicKey(publicKeyDer),
                ),
            }),
        },
    });
}

/**
 * Builds a Party-to-Participant (PTP) topology mapping.
 *
 * Declares which participant nodes host the party. Each participant is granted
 * `CONFIRMATION` permission. On initial hosting, submit the signed transaction
 * with `proposal: true` so the participant can complete authorization via the
 * topology `Authorize` RPC.
 *
 * @param partyId - Full party identifier (e.g. `hint::1220…`).
 * @param participantIds - Participant UIDs that should host the party.
 * @param threshold - Hosting threshold (≤ `participantIds.length`).
 * @returns A `TopologyMapping` containing a `PartyToParticipant` mapping.
 */
export function buildPartyToParticipantMapping(
    partyId: string,
    participantIds: string[],
    threshold: number,
): TopologyMapping {
    return TopologyMapping.create({
        mapping: {
            oneofKind: 'partyToParticipant',
            partyToParticipant: PartyToParticipant.create({
                party: partyId,
                threshold,
                participants: participantIds.map((participantId) =>
                    PartyToParticipant_HostingParticipant.create({
                        participantUid: participantId,
                        permission: Enums_ParticipantPermission.CONFIRMATION,
                    }),
                ),
            }),
        },
    });
}
