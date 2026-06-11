import { runCli } from '@layerzerolabs/vm-tooling';

import { images, tools, versionCombinations } from './config';
import { readAnchorTomlVersions } from './utility';

export { SURFPOOL_VERSION } from './config';
export { allocatePorts, rpcCall, writeProgram } from './test-helpers';

export const main = (): Promise<void> =>
    runCli({ tools, images, versionCombinations, getDefaultVersions: readAnchorTomlVersions });
