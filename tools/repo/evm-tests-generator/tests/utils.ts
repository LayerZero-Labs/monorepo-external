import type { Abi } from 'viem';
import { keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';

import type { EvmArtifact } from '@layerzerolabs/common-evm';
import { EVMBuildTarget } from '@layerzerolabs/common-evm';

import type { ArtifactSnapshotSettings, ZKSyncArtifactSnapshotSettings } from '../src/common';
import {
    extractCBORMetadata,
    extractZKSyncMetadata,
    stripCBORMetadata,
    stripZKSyncMetadata,
} from '../src/common';

export type { ArtifactSnapshotSettings, ZKSyncArtifactSnapshotSettings };
export { extractCBORMetadata, extractZKSyncMetadata, stripCBORMetadata, stripZKSyncMetadata };

export type ArtifactSnapshot = {
    artifactGetter: (buildTarget: EVMBuildTarget) => EvmArtifact<Abi>;
    evmSnapshot?: ArtifactSnapshotSettings;
    zksyncSnapshot?: ZKSyncArtifactSnapshotSettings;
    tronSnapshot?: ArtifactSnapshotSettings;
};

const snapshotTargets: {
    key: keyof Pick<ArtifactSnapshot, 'evmSnapshot' | 'zksyncSnapshot' | 'tronSnapshot'>;
    buildTarget: EVMBuildTarget;
    label: string;
}[] = [
    { key: 'evmSnapshot', buildTarget: EVMBuildTarget.DEFAULT, label: 'EVM' },
    { key: 'zksyncSnapshot', buildTarget: EVMBuildTarget.ZKSYNC, label: 'ZKSync' },
    { key: 'tronSnapshot', buildTarget: EVMBuildTarget.TRON, label: 'Tron' },
];

const metadataHelpers: Record<
    EVMBuildTarget,
    {
        strip: (bytecode: string) => `0x${string}`;
        extract: (bytecode: string) => string | undefined;
    }
> = {
    [EVMBuildTarget.DEFAULT]: { strip: stripCBORMetadata, extract: extractCBORMetadata },
    [EVMBuildTarget.TRON]: { strip: stripCBORMetadata, extract: extractCBORMetadata },
    [EVMBuildTarget.ZKSYNC]: { strip: stripZKSyncMetadata, extract: extractZKSyncMetadata },
};

const resolveMetadata = (
    settings: ArtifactSnapshotSettings | ZKSyncArtifactSnapshotSettings,
): { expected: string | undefined; label: string } => {
    if (settings.cborMetadata !== undefined) {
        return { expected: settings.cborMetadata, label: 'CBOR metadata' };
    }
    if ('metadataHash' in settings && settings.metadataHash !== undefined) {
        return { expected: settings.metadataHash, label: 'metadata hash' };
    }
    return { expected: undefined, label: 'CBOR metadata' };
};

const resolveBytecodeHash = (
    artifact: EvmArtifact<Abi>,
    settings: ArtifactSnapshotSettings | ZKSyncArtifactSnapshotSettings,
): { source: `0x${string}`; expected: string; label: string } => {
    if ('deployedBytecodeHash' in settings && settings.deployedBytecodeHash !== undefined) {
        return {
            source: artifact.deployedBytecode,
            expected: settings.deployedBytecodeHash,
            label: 'deployed bytecode hash',
        };
    }
    const { bytecodeHash } = settings;
    if (bytecodeHash === undefined) {
        throw new Error(
            'Snapshot settings must specify either `bytecodeHash` or `deployedBytecodeHash`.',
        );
    }
    return { source: artifact.bytecode, expected: bytecodeHash, label: 'bytecode hash' };
};

const generateTests = (
    artifact: EvmArtifact<Abi>,
    settings: ArtifactSnapshotSettings | ZKSyncArtifactSnapshotSettings,
    buildTarget: EVMBuildTarget,
) => {
    const buildInfo = artifact.buildInfo as
        | { solcLongVersion?: string; zksolcVersion?: string; input?: { settings?: unknown } }
        | undefined;
    const { strip, extract } = metadataHelpers[buildTarget];
    const { expected: expectedMetadata, label: metadataLabel } = resolveMetadata(settings);
    const {
        source: bytecodeSource,
        expected: expectedBytecodeHash,
        label: bytecodeHashLabel,
    } = resolveBytecodeHash(artifact, settings);

    // Ordered most-readable → least so the first failure is the most useful.
    it('should have the expected solc version', () => {
        expect(buildInfo?.solcLongVersion?.startsWith(settings.solcVersion)).toBe(true);
    });

    if ('zksolcVersion' in settings && settings.zksolcVersion !== undefined) {
        const { zksolcVersion } = settings;
        it('should have the expected zksolc version', () => {
            expect(buildInfo?.zksolcVersion).toBe(zksolcVersion);
        });
    }

    it('should have the expected compiler settings', () => {
        expect(buildInfo?.input?.settings).toMatchObject(settings.compiler);
    });

    it(`should have the expected ${bytecodeHashLabel}`, () => {
        expect(keccak256(strip(bytecodeSource))).toBe(expectedBytecodeHash);
    });

    if (expectedMetadata !== undefined) {
        it(`should have the expected ${metadataLabel}`, () => {
            expect(extract(bytecodeSource)).toBe(expectedMetadata);
        });
    }
};

/**
 * Generates a `describe` block per contract with compiler + bytecode
 * assertions, one nested block per provided target (`evmSnapshot`,
 * `zksyncSnapshot`, `tronSnapshot`). Host file must be named
 * `artifact-snapshots.test.ts`.
 */
export const generateArtifactSnapshotTests = (snapshots: Record<string, ArtifactSnapshot>) => {
    for (const [name, snapshot] of Object.entries(snapshots)) {
        const targets = snapshotTargets.filter((t) => snapshot[t.key] != null);

        describe(name, () => {
            for (const { key, buildTarget, label } of targets) {
                const settings = snapshot[key]!;
                const artifact = snapshot.artifactGetter(buildTarget);
                const sectionLabel = targets.length > 1 ? label : 'generated tests';

                describe(sectionLabel, () => {
                    generateTests(artifact, settings, buildTarget);
                });
            }
        });
    }
};
