import { runGithubMatrixGenerator } from '@layerzerolabs/vm-tooling';

import { images, versionCombinations } from '../config';

runGithubMatrixGenerator(images, 'tools/vm-tooling/vm-tooling-stellar', versionCombinations).catch(
    (error: unknown) => {
        console.error(error);
        process.exit(1);
    },
);
