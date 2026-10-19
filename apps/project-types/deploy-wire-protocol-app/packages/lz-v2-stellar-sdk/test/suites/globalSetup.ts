import { createLocalnetOnlyGlobalSetup } from '@layerzerolabs/test-utils-stellar';

import { env } from './constants.js';

export default createLocalnetOnlyGlobalSetup(env);
