import { keccak256 } from 'viem';

import { EVMBuildTarget } from '@layerzerolabs/common-evm';

import type { ArtifactSnapshotSettings, ZKSyncArtifactSnapshotSettings } from './common';
import {
    ensureHexPrefix,
    extractCBORMetadata,
    extractZKSyncMetadata,
    stripCBORMetadata,
    stripZKSyncMetadata,
} from './common';

export enum ArtifactKind {
    FOUNDRY_ARTIFACT = 'foundry-artifact',
    HARDHAT_BUILD_INFO = 'hardhat-build-info',
    HARDHAT_DEPLOYMENT = 'hardhat-deployment',
}

type SolcSettings = {
    evmVersion?: string;
    viaIR?: boolean;
    optimizer?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
};

type SolcMetadata = {
    compiler: { version: string };
    settings: SolcSettings;
};

type FoundryArtifact = {
    bytecode: { object: string };
    deployedBytecode?: { object: string };
    metadata?: SolcMetadata;
    rawMetadata?: string;
};

// `metadata` is a JSON string for EVM Hardhat build-info, an object with
// `zk_version` / `solc_version` for ZKSync.
type HardhatBuildInfoContract = {
    evm: {
        bytecode: { object: string };
        deployedBytecode?: { object: string };
    };
    metadata?: { solc_version?: string; zk_version?: string } | string;
};

export type HardhatBuildInfo = {
    solcLongVersion: string;
    input: { settings: SolcSettings };
    output: {
        contracts: Record<string, Record<string, HardhatBuildInfoContract>>;
    };
};

type HardhatDeploymentArtifact = {
    bytecode: string;
    deployedBytecode?: string;
    metadata: string;
};

const isRecord = (val: unknown): val is Record<string, unknown> =>
    val != null && typeof val === 'object' && !Array.isArray(val);

export const detectArtifactKind = (json: Record<string, unknown>): ArtifactKind => {
    if (isRecord(json.bytecode) && json.bytecode.object != null)
        return ArtifactKind.FOUNDRY_ARTIFACT;
    if (json.solcLongVersion != null && json.input != null) return ArtifactKind.HARDHAT_BUILD_INFO;
    if (typeof json.bytecode === 'string' && typeof json.metadata === 'string')
        return ArtifactKind.HARDHAT_DEPLOYMENT;
    throw new Error(
        'Not a recognized Foundry artifact, Hardhat build-info, or Hardhat deployment artifact',
    );
};

// Detect target from solcLongVersion: `zkVM-` prefix → zksync,
// `.Emscripten.clang` suffix → tron, else default (evm).
export const detectBuildTarget = (solcLongVersion: string): EVMBuildTarget => {
    if (solcLongVersion.startsWith('zkVM-')) return EVMBuildTarget.ZKSYNC;
    if (solcLongVersion.includes('.Emscripten.clang')) return EVMBuildTarget.TRON;
    return EVMBuildTarget.DEFAULT;
};

// ZKsync contracts compiled without `eraVersion` don't have a `zkVM-` prefix in `solcLongVersion`.
export const detectBuildInfoTarget = (json: HardhatBuildInfo): EVMBuildTarget => {
    const isZkSync = Object.values(json.output.contracts).some((source) =>
        Object.values(source).some((contract) => {
            const md = contract.metadata;
            return typeof md === 'object' && md !== null && md.zk_version != null;
        }),
    );
    return isZkSync ? EVMBuildTarget.ZKSYNC : detectBuildTarget(json.solcLongVersion);
};

const pickPresent = (obj: Record<string, unknown>, keys: string[]): Record<string, unknown> =>
    Object.fromEntries(keys.filter((k) => obj[k] != null).map((k) => [k, obj[k]]));

const extractFoundryMetadata = (foundry: FoundryArtifact): SolcMetadata => {
    if (foundry.metadata?.compiler != null) return foundry.metadata;
    if (foundry.rawMetadata != null) return JSON.parse(foundry.rawMetadata);
    throw new Error(
        'Foundry artifact missing both `metadata.compiler` and `rawMetadata`; cannot resolve solc settings.',
    );
};

const pickCompilerSettings = (settings: SolcSettings): ArtifactSnapshotSettings['compiler'] => ({
    ...pickPresent(settings, ['evmVersion', 'viaIR']),
    ...(settings.optimizer != null && {
        optimizer: pickPresent(settings.optimizer, ['enabled', 'runs', 'mode']),
    }),
    ...(settings.metadata != null && {
        metadata: pickPresent(settings.metadata, [
            'appendCBOR',
            'useLiteralContent',
            'bytecodeHash',
        ]),
    }),
});

const buildOptions = (
    solcLongVersion: string,
    rawBytecode: string,
    rawDeployedBytecode: string | undefined,
    settings: SolcSettings,
    zksolcVersion?: string,
): ArtifactSnapshotSettings | ZKSyncArtifactSnapshotSettings => {
    const bytecode = ensureHexPrefix(rawBytecode);
    const deployedBytecode =
        rawDeployedBytecode != null && rawDeployedBytecode.length > 0
            ? ensureHexPrefix(rawDeployedBytecode)
            : undefined;
    const target =
        zksolcVersion != null ? EVMBuildTarget.ZKSYNC : detectBuildTarget(solcLongVersion);
    const appendCBOR = settings.metadata?.appendCBOR !== false;

    const base = {
        solcVersion: solcLongVersion.split('+')[0],
        compiler: pickCompilerSettings(settings),
    };

    if (target === EVMBuildTarget.ZKSYNC) {
        const zkBase = {
            ...base,
            bytecodeHash: keccak256(stripZKSyncMetadata(bytecode)),
            ...(zksolcVersion != null && { zksolcVersion }),
        };
        const cbor = extractCBORMetadata(bytecode);
        if (cbor != null) {
            return { ...zkBase, cborMetadata: cbor };
        }
        return { ...zkBase, metadataHash: extractZKSyncMetadata(bytecode) };
    }

    // No CBOR: creation bytecode may carry a constructor tail, so prefer
    // runtime bytecode when available.
    if (!appendCBOR) {
        if (deployedBytecode != null) {
            return { ...base, deployedBytecodeHash: keccak256(deployedBytecode) };
        }
        return { ...base, bytecodeHash: keccak256(bytecode) };
    }

    // With CBOR: prefer creation bytecode; fall back to deployed only when the
    // creation bytecode has a tail that breaks CBOR detection (e.g. proxies).
    const creationCbor = extractCBORMetadata(bytecode);
    if (creationCbor == null && deployedBytecode != null) {
        const deployedCbor = extractCBORMetadata(deployedBytecode);
        if (deployedCbor != null) {
            return {
                ...base,
                deployedBytecodeHash: keccak256(stripCBORMetadata(deployedBytecode)),
                cborMetadata: deployedCbor,
            };
        }
    }

    return {
        ...base,
        bytecodeHash: keccak256(stripCBORMetadata(bytecode)),
        cborMetadata: creationCbor,
    };
};

/**
 * Extracts `ArtifactSnapshotSettings` / `ZKSyncArtifactSnapshotSettings` from
 * a Foundry artifact, Hardhat build-info, or Hardhat deployment JSON.
 * Target is auto-detected from `solcLongVersion`. `contractName` is required
 * for Hardhat build-info.
 */
export const extractTestOptions = (
    content: string,
    contractName?: string,
): ArtifactSnapshotSettings | ZKSyncArtifactSnapshotSettings => {
    const json: unknown = JSON.parse(content);
    const kind = detectArtifactKind(json as Record<string, unknown>);

    if (kind === ArtifactKind.FOUNDRY_ARTIFACT) {
        const foundry = json as FoundryArtifact;
        const metadata = extractFoundryMetadata(foundry);

        return buildOptions(
            metadata.compiler.version,
            foundry.bytecode.object,
            foundry.deployedBytecode?.object,
            metadata.settings,
        );
    }

    if (kind === ArtifactKind.HARDHAT_DEPLOYMENT) {
        const deployment = json as HardhatDeploymentArtifact;
        const metadata: SolcMetadata = JSON.parse(deployment.metadata);
        return buildOptions(
            metadata.compiler.version,
            deployment.bytecode,
            deployment.deployedBytecode,
            metadata.settings,
        );
    }

    if (contractName == null) {
        throw new Error('contractName is required for Hardhat build-info artifacts');
    }

    const hardhat = json as HardhatBuildInfo;
    const source = Object.values(hardhat.output.contracts).find((s) => contractName in s);

    if (source == null) {
        throw new Error(
            `Contract '${contractName}' not found in Hardhat build-info output.contracts`,
        );
    }

    const contractData = source[contractName];
    const contractMetadata = contractData.metadata;
    const zksolcVersion =
        typeof contractMetadata === 'object' && contractMetadata != null
            ? contractMetadata.zk_version
            : undefined;

    return buildOptions(
        hardhat.solcLongVersion,
        contractData.evm.bytecode.object,
        contractData.evm.deployedBytecode?.object,
        hardhat.input.settings,
        zksolcVersion,
    );
};
