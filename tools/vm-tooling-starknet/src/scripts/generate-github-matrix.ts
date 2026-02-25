import { runGithubMatrixGenerator } from '@layerzerolabs/vm-tooling';

import { images, versionCombinations } from '../config';

runGithubMatrixGenerator(images, 'tools/vm-tooling-starknet', versionCombinations).catch(
    (error: unknown) => {
        console.error(error);
        process.exit(1);
    },
);
