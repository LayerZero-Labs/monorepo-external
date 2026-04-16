import * as vitest from 'vitest';

import { testTools } from '@layerzerolabs/vm-tooling';

import { images, versionCombinations } from './config';

testTools(vitest, images, versionCombinations, {
    anchor: ['anchor', '--version'],
    solana: ['solana', '--version'],
    'solana-verify': ['solana-verify', '--version'],
});
