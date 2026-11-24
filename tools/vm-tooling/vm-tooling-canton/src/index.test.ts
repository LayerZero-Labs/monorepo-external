import * as vitest from 'vitest';

import { testTools } from '@layerzerolabs/vm-tooling';

import { images, versionCombinations } from './config';

testTools(vitest, images, versionCombinations, {
    dpm: ['dpm', 'version'],
    'openapi-generator': ['canton-openapi-generator', 'version'],
});
