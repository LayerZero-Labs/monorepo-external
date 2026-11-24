import { isHex, keccak256 } from 'viem';

import {
    ensureHexPrefix,
    extractCBORMetadata,
    extractZKSyncMetadata,
    stripCBORMetadata,
    stripZKSyncMetadata,
} from './common';

type CreationBytecodeResult =
    | { bytecodeHash: string; cborMetadata?: string; metadataHash?: never }
    | { bytecodeHash: string; cborMetadata?: never; metadataHash?: string };

// `deployed: true` is EVM/Tron only; ZKSync has no creation/runtime split.
type DeployedBytecodeResult = {
    deployedBytecodeHash: string;
    cborMetadata?: string;
    metadataHash?: never;
};

export type BytecodeResult = CreationBytecodeResult | DeployedBytecodeResult;

export type BytecodeTarget = 'evm' | 'zksync' | 'tron';

export type ExtractFromBytecodeOptions = {
    /** Build target (defaults to `'evm'`). */
    target?: BytecodeTarget;
    /**
     * Input is runtime bytecode; emits `deployedBytecodeHash` for a weaker
     * match when the creation bytecode has a tail (e.g. OZ v4/v5 proxies).
     * Rejected for `zksync`. Defaults to `false`.
     */
    deployed?: boolean;
};

/**
 * Computes `bytecodeHash` / `deployedBytecodeHash` and metadata from raw hex.
 * Returns `cborMetadata` (EVM / Tron / zksolc >= 1.5.13) or `metadataHash`
 * (older zksolc).
 */
export const extractFromBytecode = (
    rawHex: string,
    options: BytecodeTarget | ExtractFromBytecodeOptions = 'evm',
): BytecodeResult => {
    const { target = 'evm', deployed = false } =
        typeof options === 'string' ? { target: options } : options;
    const bytecode = ensureHexPrefix(rawHex);

    if (!isHex(bytecode, { strict: true }) || bytecode.length % 2 !== 0) {
        throw new Error(
            `Invalid hex string: ${rawHex.length > 20 ? `${rawHex.slice(0, 20)}...` : rawHex}`,
        );
    }

    if (bytecode.length <= 2) {
        throw new Error('Bytecode is empty (no data after 0x prefix).');
    }

    if (target === 'zksync') {
        if (deployed) {
            throw new Error(
                '`deployed: true` is not supported for the `zksync` target: EraVM has no creation/runtime bytecode split.',
            );
        }
        const hash = keccak256(stripZKSyncMetadata(bytecode));
        const cbor = extractCBORMetadata(bytecode);
        if (cbor != null) {
            return { bytecodeHash: hash, cborMetadata: cbor };
        }
        return { bytecodeHash: hash, metadataHash: extractZKSyncMetadata(bytecode) };
    }

    const hash = keccak256(stripCBORMetadata(bytecode));
    const cbor = extractCBORMetadata(bytecode);
    return deployed
        ? { deployedBytecodeHash: hash, cborMetadata: cbor }
        : { bytecodeHash: hash, cborMetadata: cbor };
};
