import * as vitest from 'vitest';

import { testTools } from '@layerzerolabs/vm-tooling';

import { images, versionCombinations } from './config';

testTools(vitest, images, versionCombinations, {
    forge: ['forge', '--version'],
    hardhat: ['hardhat', '--version'],
});
