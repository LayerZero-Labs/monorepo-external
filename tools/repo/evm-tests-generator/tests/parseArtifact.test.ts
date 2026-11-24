import { keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';

import { EVMBuildTarget } from '@layerzerolabs/common-evm';

import { stripCBORMetadata, stripZKSyncMetadata } from '../src/common';
import {
    ArtifactKind,
    detectArtifactKind,
    detectBuildTarget,
    extractTestOptions,
} from '../src/parseArtifact';
import {
    ZKSYNC_BYTECODE_WITH_CBOR,
    ZKSYNC_BYTECODE_WITH_RAW_HASH,
    ZKSYNC_CBOR_METADATA,
    ZKSYNC_RAW_METADATA_HASH,
} from './fixtures/zksyncBytecodes';

// body: 6080 | cbor: a164736f6c6343000816 (10 bytes) | len: 000a
const BYTECODE_WITH_CBOR = '0x6080a164736f6c6343000816000a';
const BYTECODE_WITHOUT_CBOR = '0x6080604052';
// v4-proxy-like creation bytecode: a valid CBOR in the middle, followed by a
// 32-byte storage-slot tail that breaks end-of-bytecode CBOR detection.
const BYTECODE_WITH_TAIL = `${BYTECODE_WITH_CBOR}${'00'.repeat(31)}01`;

const SOLC_LONG_VERSION = '0.8.22+commit.4fc1097e';
const EXPECTED_SOLC_VERSION = '0.8.22';
const EXPECTED_CBOR_METADATA = 'a164736f6c6343000816';
const EXPECTED_BYTECODE_HASH = keccak256(stripCBORMetadata(BYTECODE_WITH_CBOR));
const EXPECTED_BYTECODE_HASH_NO_CBOR = keccak256(BYTECODE_WITHOUT_CBOR);
const EXPECTED_COMPILER_SETTINGS = {
    evmVersion: 'paris',
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    metadata: { bytecodeHash: 'ipfs' },
};

const foundryArtifact = (bytecode = BYTECODE_WITH_CBOR, deployedBytecode = bytecode) => ({
    abi: [],
    bytecode: { object: bytecode, sourceMap: '', linkReferences: {} },
    deployedBytecode: { object: deployedBytecode, sourceMap: '', linkReferences: {} },
    metadata: {
        compiler: { version: SOLC_LONG_VERSION },
        language: 'Solidity',
        settings: { ...SOLC_SETTINGS },
    },
});

const SOLC_SETTINGS = {
    compilationTarget: { 'contracts/Test.sol': 'Test' },
    evmVersion: 'paris',
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    metadata: { bytecodeHash: 'ipfs' },
};

const hardhatDeployment = (bytecode = BYTECODE_WITH_CBOR, deployedBytecode = bytecode) => ({
    address: '0x0000000000000000000000000000000000000001',
    abi: [],
    transactionHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    bytecode,
    deployedBytecode,
    metadata: JSON.stringify({
        compiler: { version: SOLC_LONG_VERSION },
        language: 'Solidity',
        settings: { ...SOLC_SETTINGS },
    }),
});

const hardhatBuildInfo = (
    contractName = 'Test',
    bytecodeHex = BYTECODE_WITH_CBOR.slice(2),
    solcLongVersion = SOLC_LONG_VERSION,
    contractMetadata?: { zk_version?: string },
    deployedBytecodeHex = bytecodeHex,
) => ({
    _format: 'hh-sol-build-info-1',
    solcVersion: solcLongVersion.split('+')[0],
    solcLongVersion,
    input: {
        language: 'Solidity',
        sources: {},
        settings: {
            evmVersion: 'paris',
            optimizer: { enabled: true, runs: 200 },
            viaIR: true,
            metadata: { appendCBOR: true, useLiteralContent: true, bytecodeHash: 'ipfs' },
        },
    },
    output: {
        contracts: {
            [`contracts/${contractName}.sol`]: {
                [contractName]: {
                    abi: [],
                    evm: {
                        bytecode: { object: bytecodeHex },
                        deployedBytecode: { object: deployedBytecodeHex },
                    },
                    ...(contractMetadata != null && { metadata: contractMetadata }),
                },
            },
        },
    },
});

describe('detectArtifactKind', () => {
    it('detects Foundry artifacts', () => {
        expect(detectArtifactKind(foundryArtifact())).toBe(ArtifactKind.FOUNDRY_ARTIFACT);
    });

    it('detects Hardhat build-info artifacts', () => {
        expect(detectArtifactKind(hardhatBuildInfo())).toBe(ArtifactKind.HARDHAT_BUILD_INFO);
    });

    it('detects Hardhat deployment artifacts', () => {
        expect(detectArtifactKind(hardhatDeployment())).toBe(ArtifactKind.HARDHAT_DEPLOYMENT);
    });

    it('throws for unrecognized formats', () => {
        expect(() => detectArtifactKind({ foo: 'bar' })).toThrow('Not a recognized');
    });
});

describe('detectBuildTarget', () => {
    it('maps solcLongVersion to the expected target', () => {
        expect(detectBuildTarget('zkVM-0.8.23-1.0.1')).toBe(EVMBuildTarget.ZKSYNC);
        expect(detectBuildTarget('0.8.23+commit.8ed33446.Emscripten.clang')).toBe(
            EVMBuildTarget.TRON,
        );
        expect(detectBuildTarget('0.8.22+commit.4fc1097e')).toBe(EVMBuildTarget.DEFAULT);
    });
});

describe('extractTestOptions (Foundry)', () => {
    it('extracts expected values', () => {
        expect(extractTestOptions(JSON.stringify(foundryArtifact()))).toEqual({
            solcVersion: EXPECTED_SOLC_VERSION,
            bytecodeHash: EXPECTED_BYTECODE_HASH,
            cborMetadata: EXPECTED_CBOR_METADATA,
            compiler: EXPECTED_COMPILER_SETTINGS,
        });
    });

    it('falls back to rawMetadata', () => {
        const { metadata, ...rest } = foundryArtifact();
        const artifact = { ...rest, rawMetadata: JSON.stringify(metadata) };

        const result = extractTestOptions(JSON.stringify(artifact));
        expect(result.solcVersion).toBe(EXPECTED_SOLC_VERSION);
        expect(result.compiler.evmVersion).toBe('paris');
    });

    it('omits viaIR when absent', () => {
        const artifact = foundryArtifact();
        delete (artifact.metadata.settings as Record<string, unknown>).viaIR;

        expect(extractTestOptions(JSON.stringify(artifact)).compiler.viaIR).toBeUndefined();
    });

    it('returns undefined CBOR metadata when bytecode has none', () => {
        const result = extractTestOptions(JSON.stringify(foundryArtifact(BYTECODE_WITHOUT_CBOR)));

        expect(result.cborMetadata).toBeUndefined();
        expect(result.bytecodeHash).toBe(EXPECTED_BYTECODE_HASH_NO_CBOR);
    });
});

describe('extractTestOptions (Hardhat build-info)', () => {
    it('extracts expected values', () => {
        expect(extractTestOptions(JSON.stringify(hardhatBuildInfo()), 'Test')).toEqual({
            solcVersion: EXPECTED_SOLC_VERSION,
            bytecodeHash: EXPECTED_BYTECODE_HASH,
            cborMetadata: EXPECTED_CBOR_METADATA,
            compiler: {
                evmVersion: 'paris',
                optimizer: { enabled: true, runs: 200 },
                viaIR: true,
                metadata: { appendCBOR: true, useLiteralContent: true, bytecodeHash: 'ipfs' },
            },
        });
    });

    it('throws when contractName is not provided', () => {
        expect(() => extractTestOptions(JSON.stringify(hardhatBuildInfo()))).toThrow(
            'contractName is required',
        );
    });

    it('throws when contractName is not found', () => {
        expect(() => extractTestOptions(JSON.stringify(hardhatBuildInfo()), 'Missing')).toThrow(
            "Contract 'Missing' not found",
        );
    });

    it('returns undefined CBOR metadata when bytecode has none', () => {
        const result = extractTestOptions(
            JSON.stringify(hardhatBuildInfo('Test', BYTECODE_WITHOUT_CBOR.slice(2))),
            'Test',
        );

        expect(result.cborMetadata).toBeUndefined();
        expect(result.bytecodeHash).toBe(EXPECTED_BYTECODE_HASH_NO_CBOR);
    });

    it('auto-detects Tron target and uses CBOR extraction', () => {
        const bi = hardhatBuildInfo(
            'Test',
            BYTECODE_WITH_CBOR.slice(2),
            '0.8.23+commit.8ed33446.Emscripten.clang',
        );
        expect(extractTestOptions(JSON.stringify(bi), 'Test')).toMatchObject({
            solcVersion: '0.8.23',
            bytecodeHash: EXPECTED_BYTECODE_HASH,
            cborMetadata: EXPECTED_CBOR_METADATA,
        });
    });

    it('extracts ZKSync metadataHash for old zksolc (< 1.5.13)', () => {
        const bi = hardhatBuildInfo(
            'Test',
            ZKSYNC_BYTECODE_WITH_RAW_HASH.slice(2),
            'zkVM-0.8.23-1.0.1',
        );
        expect(extractTestOptions(JSON.stringify(bi), 'Test')).toMatchObject({
            bytecodeHash: keccak256(stripZKSyncMetadata(ZKSYNC_BYTECODE_WITH_RAW_HASH)),
            metadataHash: ZKSYNC_RAW_METADATA_HASH,
        });
    });

    it('detects ZKSync from contract metadata.zk_version when solcLongVersion has no zkVM- prefix', () => {
        const bi = hardhatBuildInfo(
            'Test',
            ZKSYNC_BYTECODE_WITH_RAW_HASH.slice(2),
            '0.8.22+commit.4fc1097e',
            { zk_version: '1.3.22' },
        );
        const result = extractTestOptions(JSON.stringify(bi), 'Test');
        expect(result).toMatchObject({
            bytecodeHash: keccak256(stripZKSyncMetadata(ZKSYNC_BYTECODE_WITH_RAW_HASH)),
            metadataHash: ZKSYNC_RAW_METADATA_HASH,
            zksolcVersion: '1.3.22',
        });
        expect(result.cborMetadata).toBeUndefined();
    });

    it('extracts ZKSync cborMetadata and zksolcVersion for new zksolc (>= 1.5.13)', () => {
        const bi = hardhatBuildInfo(
            'Test',
            ZKSYNC_BYTECODE_WITH_CBOR.slice(2),
            'zkVM-0.8.23-1.0.2',
            { zk_version: '1.5.15' },
        );
        expect(extractTestOptions(JSON.stringify(bi), 'Test')).toMatchObject({
            bytecodeHash: keccak256(stripZKSyncMetadata(ZKSYNC_BYTECODE_WITH_CBOR)),
            cborMetadata: ZKSYNC_CBOR_METADATA,
            zksolcVersion: '1.5.15',
        });
    });
});

describe('extractTestOptions (Hardhat deployment)', () => {
    it('extracts expected values', () => {
        expect(extractTestOptions(JSON.stringify(hardhatDeployment()))).toEqual({
            solcVersion: EXPECTED_SOLC_VERSION,
            bytecodeHash: EXPECTED_BYTECODE_HASH,
            cborMetadata: EXPECTED_CBOR_METADATA,
            compiler: EXPECTED_COMPILER_SETTINGS,
        });
    });

    it('does not require contractName', () => {
        expect(() => extractTestOptions(JSON.stringify(hardhatDeployment()))).not.toThrow();
    });

    it('returns undefined CBOR metadata when bytecode has none', () => {
        const result = extractTestOptions(JSON.stringify(hardhatDeployment(BYTECODE_WITHOUT_CBOR)));

        expect(result.cborMetadata).toBeUndefined();
        expect(result.bytecodeHash).toBe(EXPECTED_BYTECODE_HASH_NO_CBOR);
    });
});

describe('extractTestOptions (deployed bytecode fallback)', () => {
    it('falls back to deployedBytecodeHash when creation bytecode has a trailing tail', () => {
        const result = extractTestOptions(
            JSON.stringify(foundryArtifact(BYTECODE_WITH_TAIL, BYTECODE_WITH_CBOR)),
        );

        expect(result).toMatchObject({
            deployedBytecodeHash: EXPECTED_BYTECODE_HASH,
            cborMetadata: EXPECTED_CBOR_METADATA,
        });
        expect(result).not.toHaveProperty('bytecodeHash');
    });

    it('keeps creation bytecodeHash when creation CBOR detection succeeds', () => {
        const result = extractTestOptions(
            JSON.stringify(foundryArtifact(BYTECODE_WITH_CBOR, BYTECODE_WITH_TAIL)),
        );

        expect(result).toMatchObject({ bytecodeHash: EXPECTED_BYTECODE_HASH });
        expect(result).not.toHaveProperty('deployedBytecodeHash');
    });

    it('honors appendCBOR: false by hashing deployed bytecode without CBOR stripping', () => {
        const artifact = foundryArtifact(BYTECODE_WITH_TAIL, BYTECODE_WITHOUT_CBOR);
        (artifact.metadata.settings.metadata as Record<string, unknown>).appendCBOR = false;

        const result = extractTestOptions(JSON.stringify(artifact));
        expect(result).toMatchObject({ deployedBytecodeHash: keccak256(BYTECODE_WITHOUT_CBOR) });
        expect(result.cborMetadata).toBeUndefined();
    });
});
