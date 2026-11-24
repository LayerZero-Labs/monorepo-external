import {
    MultiTransactionSignatures,
    Signature,
    SignatureFormat,
    SignedTopologyTransaction,
    SigningAlgorithmSpec,
} from '@canton-network/core-ledger-proto';

/** A single namespace-key signature over the multi-transaction hash. */
export type TopologySignature = {
    /** Fingerprint of the signing key (Canton `signedBy`). */
    signerFingerprint: string;
    /** Raw DER ECDSA-SHA256 signature bytes over the multi-transaction hash. */
    signatureBytes: Uint8Array;
};

/**
 * Wraps namespace-key signatures over one or more topology transaction hashes.
 *
 * Use with {@link computeMultiTransactionHash}: sign the multi-hash once per key,
 * then pass the raw signatures here to cover every hash in the batch.
 */
export function buildMultiTransactionSignatures(
    transactionHashes: Uint8Array[],
    signatures: readonly TopologySignature[],
): MultiTransactionSignatures {
    return MultiTransactionSignatures.create({
        transactionHashes,
        signatures: signatures.map((entry) =>
            Signature.create({
                format: SignatureFormat.DER,
                signature: entry.signatureBytes,
                signedBy: entry.signerFingerprint,
                signingAlgorithmSpec: SigningAlgorithmSpec.EC_DSA_SHA_256,
            }),
        ),
    });
}

/**
 * Builds a {@link SignedTopologyTransaction} ready for
 * {@link CantonGrpcClient.submitTopologyTransactions}.
 *
 * Set `proposal: true` when the hosting participant must authorize the mapping.
 */
export function buildSignedTransaction(
    transaction: Uint8Array,
    multiTransactionSignatures: MultiTransactionSignatures[],
    proposal = false,
): SignedTopologyTransaction {
    return SignedTopologyTransaction.create({
        transaction,
        multiTransactionSignatures,
        proposal,
    });
}
