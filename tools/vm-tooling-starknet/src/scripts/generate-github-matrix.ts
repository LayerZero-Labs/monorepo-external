import { runGithubMatrixGenerator } from '@layerzerolabs/vm-tooling';

import { images } from '../config';

runGithubMatrixGenerator(images, 'tools/vm-tooling-starknet').catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
