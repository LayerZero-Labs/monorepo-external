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
