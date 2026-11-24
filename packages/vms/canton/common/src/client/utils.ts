import { createHash } from 'node:crypto';

import { bytesToHex } from '@layerzerolabs/common-encoding-utils';

import { SECP256K1_SPKI_DER_HEADER } from '../crypto';
import type { CantonTransaction, CantonUpdate } from './interface';

/**
 * Extract transactions from Canton updates.
 * Filters out checkpoints, reassignments, and topology transactions.
 */
export function extractTransactions(updates: CantonUpdate[]): CantonTransaction[] {
    return updates.flatMap((update) => ('Transaction' in update ? [update.Transaction.value] : []));
}

const HASH_PURPOSE_PUBLIC_KEY_FINGERPRINT = 12;
const HASH_PURPOSE_DECENTRALIZED_NAMESPACE = 37;
const MULTIHASH_SHA256_PREFIX = new Uint8Array([0x12, 0x20]);

/**
 * Canton multihash: `0x1220 || SHA-256(BE32(purpose) || data)`.
 */
export function cantonMultihash(purpose: number, data: Uint8Array): Uint8Array {
    const purposePrefix = new Uint8Array(4);
    new DataView(purposePrefix.buffer).setUint32(0, purpose);

    const hash = createHash('sha256').update(purposePrefix).update(data).digest();

    const result = new Uint8Array(MULTIHASH_SHA256_PREFIX.length + hash.length);
    result.set(MULTIHASH_SHA256_PREFIX);
    result.set(hash, MULTIHASH_SHA256_PREFIX.length);
    return result;
}

/**
 * Canton fingerprint for a DER-encoded public key (purpose 12).
 * For root NSD, this is also the namespace id.
 */
export function computePublicKeyFingerprint(publicKeyDer: Uint8Array): string {
    return bytesToHex(cantonMultihash(HASH_PURPOSE_PUBLIC_KEY_FINGERPRINT, publicKeyDer));
}

/**
 * Computes the Canton fingerprint for an uncompressed secp256k1 public key.
 * DER-encodes the key, then computes hex(SHA-256 multihash of purpose=12 || publicKeyDer).
 */
export function computeCantonFingerprint(uncompressedPublicKey: Uint8Array): string {
    const publicKeyDer = new Uint8Array(
        SECP256K1_SPKI_DER_HEADER.length + uncompressedPublicKey.length,
    );
    publicKeyDer.set(SECP256K1_SPKI_DER_HEADER);
    publicKeyDer.set(uncompressedPublicKey, SECP256K1_SPKI_DER_HEADER.length);

    return computePublicKeyFingerprint(publicKeyDer);
}

/**
 * Deterministic decentralized-namespace fingerprint from owner key fingerprints.
 * `"1220" + SHA256(purpose=37 || for each sorted owner: len(utf8) || utf8)`.
 *
 * For threshold-1 / single-owner namespaces this is `computeDecentralizedNamespace([keyFp])`,
 * which is the party id suffix — not the raw key fingerprint.
 */
export function computeDecentralizedNamespace(owners: string[]): string {
    const sorted = [...owners].map((owner) => owner.replace(/^0x/i, '')).sort();
    const hash = createHash('sha256');
    const purposeBuf = Buffer.alloc(4);
    purposeBuf.writeUInt32BE(HASH_PURPOSE_DECENTRALIZED_NAMESPACE);
    hash.update(purposeBuf);
    for (const owner of sorted) {
        const ownerBuf = Buffer.from(owner, 'utf-8');
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32BE(ownerBuf.length);
        hash.update(lenBuf);
        hash.update(ownerBuf);
    }
    return `1220${hash.digest('hex')}`;
}
