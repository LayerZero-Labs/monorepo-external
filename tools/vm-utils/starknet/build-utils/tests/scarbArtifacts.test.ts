import { rmSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { readScarbArtifactIndex } from '../src/scarbArtifacts';

const buildDirectories: string[] = [];

afterAll(() => {
    for (const directory of buildDirectories) {
        rmSync(directory, { recursive: true, force: true });
    }
});

const createBuildDirectory = async (index?: unknown): Promise<string> => {
    const buildDirectory = await mkdtemp(join(tmpdir(), 'scarb-artifacts-'));
    buildDirectories.push(buildDirectory);

    if (index !== undefined) {
        await writeFile(
            join(buildDirectory, 'layerzero.starknet_artifacts.json'),
            JSON.stringify(index),
        );
    }

    return buildDirectory;
};

const indexDeclaring = (sierra: string, casm: string) => ({
    contracts: [{ contract_name: 'Dvn', artifacts: { sierra, casm } }],
});

describe(readScarbArtifactIndex, () => {
    it('returns the declared contracts', async () => {
        const buildDirectory = await createBuildDirectory(
            indexDeclaring('layerzero_Dvn.contract_class.json', 'layerzero_Dvn.casm.json'),
        );

        await expect(
            readScarbArtifactIndex({ buildDirectory, scarbPackage: 'layerzero' }),
        ).resolves.toEqual(
            indexDeclaring('layerzero_Dvn.contract_class.json', 'layerzero_Dvn.casm.json'),
        );
    });

    it.each(['', '../outside.json', '/absolute.json'])(
        'rejects the artifact path %j',
        async (artifactPath) => {
            const buildDirectory = await createBuildDirectory(
                indexDeclaring(artifactPath, 'layerzero_Dvn.casm.json'),
            );

            await expect(
                readScarbArtifactIndex({ buildDirectory, scarbPackage: 'layerzero' }),
            ).rejects.toThrow('does not match the expected schema');
        },
    );

    it('points at the missing build step when the index is absent', async () => {
        const buildDirectory = await createBuildDirectory();

        await expect(
            readScarbArtifactIndex({ buildDirectory, scarbPackage: 'layerzero' }),
        ).rejects.toThrow('Scarb artifact index not found');
    });
});
