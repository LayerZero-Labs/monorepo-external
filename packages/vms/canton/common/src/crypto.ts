/**
 * gRPC-free secp256k1 / DER helpers shared across Canton packages. Kept in a
 * dependency-light module (no ledger client, no ethers) so pure encoding/signing
 * SDKs can reuse it without pulling the gRPC client graph.
 *
 * DER signature encoding reuses `@noble/secp256k1` rather than hand-rolling ASN.1.
 */

import * as secp256k1 from '@noble/secp256k1';

import { trim0x } from '@layerzerolabs/common-encoding-utils';

/** DER header for secp256k1 SubjectPublicKeyInfo (23 bytes), up to the `00` bit-string pad. */
export const SECP256K1_SPKI_DER_HEADER = new Uint8Array([
    0x30, 0x56, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x05, 0x2b,
    0x81, 0x04, 0x00, 0x0a, 0x03, 0x42, 0x00,
]);

/** Hex form of {@link SECP256K1_SPKI_DER_HEADER} (lowercase, no `0x`). */
export const SECP256K1_SPKI_DER_HEADER_HEX = Buffer.from(SECP256K1_SPKI_DER_HEADER).toString('hex');

/**
 * Wrap an uncompressed `0x04‖X‖Y` secp256k1 public key as hex-encoded SPKI-DER
 * (the form the Canton ledger's `MultiSig.SignerSignature` carries).
 */
export function publicKeyToSpkiDer(uncompressedPublicKey: string): string {
    const body = trim0x(uncompressedPublicKey).toLowerCase();
    if (body.length !== 130 || !body.startsWith('04')) {
        throw new Error('Expected an uncompressed (65-byte, 0x04…) secp256k1 public key');
    }
    return SECP256K1_SPKI_DER_HEADER_HEX + body;
}

/**
 * DER-encode an ECDSA `(r, s)` signature as `SEQUENCE { INTEGER r, INTEGER s }`
 * (lowercase hex), via `@noble/secp256k1` so the ASN.1 encoding is not hand-rolled.
 * `r` / `s` are accepted as hex (with or without `0x`) and zero-padded to 32 bytes.
 */
export function derEncodeSignature(r: string, s: string): string {
    const compact = trim0x(r).padStart(64, '0') + trim0x(s).padStart(64, '0');
    return secp256k1.Signature.fromCompact(compact).toDERHex();
}
