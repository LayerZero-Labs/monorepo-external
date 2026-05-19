import { ethers } from 'ethers';

const DOMAIN = {
    name: 'OneSig',
    version: '1',
} as const;

const TYPES = {
    SignerProof: [
        { name: 'leafHash', type: 'bytes32' },
        { name: 'merkleRoot', type: 'bytes32' },
        { name: 'delegate', type: 'bytes' },
        { name: 'signerProofExpiry', type: 'uint64' },
    ],
};

/**
 * Produces the 65-byte (r‖s‖v) `signer_proof` by signing an EIP-712
 * `SignerProof` struct. The contract recovers the signer address in
 * `verify_signer_as_executor_permissions` using the same digest.
 *
 * Domain: { name: "OneSig", version: "1" }
 * Type:   SignerProof(bytes32 leafHash, bytes32 merkleRoot, bytes delegate, uint64 signerProofExpiry)
 *
 * `merkleRoot` is bound so the proof is valid only against the operator-approved
 * batch the signer intended (see signer-as-executor.md §"Binding to merkle_root").
 */
export async function signSignerProof(
    signer: ethers.Wallet,
    leafHash: Uint8Array | Buffer,
    merkleRoot: Uint8Array | Buffer,
    delegate: Uint8Array | Buffer,
    signerProofExpiry: bigint,
): Promise<Buffer> {
    const value = {
        leafHash: ethers.utils.hexlify(leafHash),
        merkleRoot: ethers.utils.hexlify(merkleRoot),
        delegate: ethers.utils.hexlify(delegate),
        signerProofExpiry,
    };
    const signatureHex = await signer._signTypedData(DOMAIN, TYPES, value);
    return Buffer.from(ethers.utils.arrayify(signatureHex));
}
