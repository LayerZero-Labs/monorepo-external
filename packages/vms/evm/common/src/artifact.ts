import type { AbiType, AbiTypeToPrimitiveType } from 'abitype';
import type { Abi, Hex } from 'viem';

import { ChainName } from '@layerzerolabs/layerzero-definitions';
import { isZkChain } from '@layerzerolabs/static-chain-info';

export type { Abi, AbiType, AbiTypeToPrimitiveType, Hex };

export enum FileNames {
    ABI_BYTECODE = 'abiBytecode',
    BUILD_INFO = 'buildInfo',
}

export type AbiBytecodeJson = {
    contractName: string;
    abi: unknown;
    bytecode: string;
    deployedBytecode: string;
    sourceName: string;
};

export type BuildInfoJson = Record<string, unknown>;

export enum EVMBuildTarget {
    DEFAULT = 'default',
    TRON = 'tron',
    ZKSYNC = 'zksync',
}

/**
 * Maps a `ChainName` to the corresponding `EVMBuildTarget` so that activity impls can resolve
 * the correct artifact variant without per-chain overrides.
 *
 * TODO: this shouldn't be part of `common-evm` package since it leaks LZ-specific `ChainName`
 * to non-LZ-specific consumers.
 */
export const chainNameToBuildTarget = (chainName: ChainName): EVMBuildTarget => {
    if (chainName === ChainName.TRON) return EVMBuildTarget.TRON;
    if (isZkChain(chainName)) return EVMBuildTarget.ZKSYNC;
    return EVMBuildTarget.DEFAULT;
};

export type EvmArtifact<TAbi extends Abi> = {
    name: string;
    abi: TAbi;
    bytecode: Hex;
    deployedBytecode: Hex;
    buildInfo?: BuildInfoJson;
    sourceName?: string;
    contractName: string;
    // Tron only
    flattenedSol?: {
        flattenedSolSourceBase64: string;
    };
};
