import * as vitest from 'vitest';

import { testTools } from '@layerzerolabs/vm-tooling';

import { images, tools, versionCombinations } from './config';

testTools(vitest, images, versionCombinations, {
    anchor: ['anchor', '--version'],
    solana: ['solana', '--version'],
    'solana-verify': ['solana-verify', '--version'],
    surfpool: ['surfpool', '--version'],
});

vitest.describe('defaultEnv', () => {
    vitest.it.for(['anchor', 'solana'])(
        '%s disables rustc incremental so turbo prune cannot EACCES session locks',
        (name, { expect }) => {
            const tool = tools.find((candidate) => candidate.name === name);
            expect(tool?.defaultEnv).toEqual(
                expect.arrayContaining([{ name: 'CARGO_INCREMENTAL', value: '0' }]),
            );
        },
    );
});

vitest.describe('cargo cache env', () => {
    vitest.it.for(['anchor', 'solana', 'solana-verify'])(
        '%s turns off cargo automatic cache cleaning',
        (name, { expect }) => {
            const tool = tools.find((candidate) => candidate.name === name);
            expect(tool?.defaultEnv).toEqual(
                expect.arrayContaining([
                    { name: 'CARGO_CACHE_AUTO_CLEAN_FREQUENCY', value: 'never' },
                ]),
            );
        },
    );
});

vitest.describe.sequential('CARGO_BUILD_JOBS', () => {
    const loadTools = async (ci: string | undefined) => {
        vitest.vi.stubEnv('CI', ci);
        vitest.vi.resetModules();
        return (await import('./config')).tools;
    };

    vitest.afterEach(() => {
        vitest.vi.unstubAllEnvs();
    });

    vitest.it.for(['anchor', 'solana'])(
        '%s caps cargo build jobs at 4 when CI is not set',
        async (name, { expect }) => {
            const tool = (await loadTools(undefined)).find((candidate) => candidate.name === name);

            expect(tool?.defaultEnv).toEqual(
                expect.arrayContaining([{ name: 'CARGO_BUILD_JOBS', value: '4' }]),
            );
        },
    );

    vitest.it.for(['anchor', 'solana', 'solana-verify'])(
        '%s sets no cargo build jobs cap when CI is set',
        async (name, { expect }) => {
            const tool = (await loadTools('true')).find((candidate) => candidate.name === name);

            expect(tool?.defaultEnv?.map((variable) => variable.name)).not.toContain(
                'CARGO_BUILD_JOBS',
            );
        },
    );
});

vitest.describe('defaultVolumes', () => {
    vitest.it.for(['anchor', 'solana', 'solana-verify'])(
        '%s locks no volume',
        (name, { expect }) => {
            const tool = tools.find((candidate) => candidate.name === name);
            expect(
                tool?.defaultVolumes?.filter(
                    (volume) => volume.type === 'isolate' && volume.locked,
                ),
            ).toEqual([]);
        },
    );

    vitest.it.for(['anchor', 'solana', 'solana-verify'])(
        '%s mounts the cargo volume nocopy and the build-dir volume, and no rustup volume',
        (name, { expect }) => {
            const tool = tools.find((candidate) => candidate.name === name);
            expect(tool?.defaultVolumes?.filter((volume) => volume.type === 'isolate')).toEqual([
                {
                    type: 'isolate',
                    containerPath: '/usr/local/cargo',
                    name: 'solana-cargo',
                    toolchainKeyed: true,
                    nocopy: true,
                },
                {
                    type: 'isolate',
                    containerPath: '/cargo-target',
                    name: 'solana-target',
                    toolchainKeyed: true,
                },
            ]);
        },
    );
});
