import { keccak_256 } from '@noble/hashes/sha3';
import * as secp from '@noble/secp256k1';

/**
 * A secp256k1 key pair with private key and derived Ethereum-style address.
 * Used for DVN multisig signing.
 */
export class Secp256k1KeyPair {
    private privateKey: Uint8Array;
    public readonly ethAddress: Buffer;

    constructor(privateKey: Uint8Array | Buffer | string) {
        if (typeof privateKey === 'string') {
            // Remove 0x prefix if present
            const hex = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
            this.privateKey = Buffer.from(hex, 'hex');
        } else {
            this.privateKey = new Uint8Array(privateKey);
        }
        this.ethAddress = this.deriveEthAddress();
    }

    /**
     * Generate a random key pair.
     */
    static generate(): Secp256k1KeyPair {
        const privateKey = secp.utils.randomPrivateKey();
        return new Secp256k1KeyPair(privateKey);
    }

    /**
     * Derive Ethereum-style address from the public key.
     * Address = last 20 bytes of keccak256(uncompressed_pubkey[1:65])
     */
    private deriveEthAddress(): Buffer {
        const publicKey = secp.getPublicKey(this.privateKey, false); // uncompressed
        const pubkeyWithoutPrefix = publicKey.slice(1); // remove 0x04 prefix
        const hash = keccak_256(pubkeyWithoutPrefix);
        return Buffer.from(hash.slice(12)); // last 20 bytes
    }

    /**
     * Sign a 32-byte digest and return a 65-byte signature (r || s || v).
     */
    async sign(digest: Uint8Array): Promise<Buffer> {
        const [signature, recoveryId] = await secp.sign(digest, this.privateKey, {
            canonical: true,
            recovered: true,
            der: false,
        });

        const v = 27 + recoveryId;
        const result = Buffer.alloc(65);
        result.set(signature, 0); // r (32 bytes) + s (32 bytes)
        result[64] = v;

        return result;
    }
}
